import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySpeakFailure,
  onceRetry,
  runSpeakAction,
  sanitizeSpeakMessage,
  snapshotSpeakRetryParams,
} from "./speak-action.ts";
import { speakCanRetry } from "./speak-failures.ts";
import { MAX_AUDIO_BASE64_CHARS } from "./voice-input.ts";

describe("classifySpeakFailure", () => {
  it("keys off ok, not the HTTP status", () => {
    const fromBody = classifySpeakFailure({ ok: false, status: 200, error: "Sign in is required before using Speak." });
    assert.equal(fromBody.kind, "auth_required");
    assert.match(fromBody.message, /Sign in is required/);
    const ignored = classifySpeakFailure({ ok: true, status: 500, text: "" });
    assert.equal(ignored.message, "");
  });

  it("strips tokens and raw provider bodies", () => {
    const leaked = classifySpeakFailure({
      ok: false,
      transport: { ok: false, status: 0, ms: 1 },
      error: "Bearer xai-super-secret-token-value failed {\"api_key\":\"xai-super-secret-token-value\",\"raw\":true}",
    });
    assert.equal(leaked.kind, "network_failure");
    assert.equal(leaked.message.includes("xai-super-secret-token-value"), false);
    assert.equal(leaked.message.includes("api_key"), false);
    assert.equal(sanitizeSpeakMessage("sk-abcdefghijklmnopqrstuvwxyz").includes("sk-abc"), false);
  });

  it("treats rpc.isError as a failure and transport failure as network or timeout", () => {
    const rpc = classifySpeakFailure({
      ok: false,
      transport: { ok: true, status: 200, ms: 4 },
      rpc: { isError: true, content: [{ type: "text", text: "No speech key is configured." }] },
    });
    assert.equal(rpc.kind, "model_unavailable");
    const timeout = classifySpeakFailure({ ok: false, code: "timeout", transport: { ok: false, status: 0, ms: 10 } });
    assert.equal(timeout.kind, "chat_timeout");
  });
});

describe("runSpeakAction retry", () => {
  it("reuses identical captured bytes and MIME after an explicit unsent input refusal", async () => {
    const capture = { audioBase64: " bWlj\n", mime: "audio/mp4;codecs=mp4a.40.2" };
    let captures = 0, transcribes = 0, chats = 0;
    const deps = {
      capture: async () => { captures++; return { ok: true, ...capture }; },
      transcribe: async (audioBase64: string, mime: string) => {
        transcribes++;
        assert.deepEqual({ audioBase64, mime }, capture);
        return transcribes === 1
          ? { ok: false, error: "Review the estimated cost before continuing.", dispatched: false, approvalId: "review-input" }
          : { ok: true, text: "weather please" };
      },
      chatTurn: async () => { chats++; return { ok: true, text: "Sunny." }; },
    };
    const first = await runSpeakAction(snapshotSpeakRetryParams({ correlationId: "voice-input-review" }), deps);
    assert.equal(first.ok, false);
    assert.deepEqual(first.params.inputAudio, capture);
    if (!first.ok) assert.equal(speakCanRetry(first.message, first.params), true);
    const retry = await runSpeakAction(first.params, deps);
    assert.equal(retry.ok, true);
    assert.equal(retry.params.correlationId, "voice-input-review");
    assert.deepEqual([captures, transcribes, chats], [1, 2, 1]);
    assert.equal(retry.params.inputAudio, undefined);
    assert.equal(retry.params.transcript, "weather please");
  });

  it("does not replay an ambiguous input result or thrown input failure", async () => {
    for (const throws of [false, true]) {
      let transcribes = 0;
      const first = await runSpeakAction(snapshotSpeakRetryParams({}), {
        capture: async () => ({ ok: true, audioBase64: "bWlj", mime: "audio/webm" }),
        transcribe: async () => {
          transcribes++;
          if (throws) throw new Error("Connection lost after sending input.");
          return { ok: false, error: "The input response was lost." };
        },
      });
      assert.equal(first.ok, false);
      assert.equal(first.params.inputDeliveryUncertain, true);
      assert.equal(first.params.inputAudio, undefined);
      if (!first.ok) assert.equal(speakCanRetry(first.message, first.params), false);
      const retry = await runSpeakAction(first.params, { transcribe: async () => { transcribes++; return { ok: true, text: "must not run" }; } });
      assert.equal(retry.ok, false);
      if (!retry.ok) assert.equal(retry.noop, true);
      assert.equal(transcribes, 1);
    }
  });

  it("retains the original answer request after explicit non-dispatch and skips capture and STT on retry", async () => {
    let captures = 0, transcribes = 0, chats = 0;
    const request = { chatId: "chat-original", operationId: "voice-answer-original", body: { provider: "openai", model: "fixture-model", taskId: "voice-root", messages: [{ role: "user", content: "weather please" }] } };
    const deps = {
      capture: async () => { captures++; return { ok: true, audioBase64: "bWlj", mime: "audio/webm" }; },
      transcribe: async () => { transcribes++; return { ok: true, text: "weather please" }; },
      chatTurn: async (text: string) => {
        chats++;
        assert.equal(text, "weather please");
        return chats === 1
          ? { ok: false, dispatched: false, error: "Review this answer estimate.", approvalId: "review-answer", answerRequest: request }
          : { ok: true, text: "Sunny." };
      },
    };
    const first = await runSpeakAction(snapshotSpeakRetryParams({ correlationId: "voice-root", projectId: "project-original" }), deps);
    assert.equal(first.ok, false);
    assert.equal(first.params.chatCommitted, false);
    assert.equal(first.params.inputAudio, undefined);
    assert.deepEqual(first.params.answerRequest, request);
    request.body.messages[0]!.content = "changed selection must not change retained request";
    assert.equal((first.params.answerRequest!.body.messages as Array<{ content: string }>)[0]!.content, "weather please");
    if (!first.ok) assert.equal(speakCanRetry(first.message, first.params), true);
    const again = await runSpeakAction(snapshotSpeakRetryParams(first.params), deps);
    assert.equal(again.ok, true);
    assert.deepEqual([captures, transcribes, chats], [1, 1, 2]);
    assert.equal(again.params.chatCommitted, true);
    assert.equal(again.params.answerRequest, undefined);
    assert.equal(again.params.projectId, "project-original");
  });

  it("does not infer safe answer replay from a refusal without an exact retained request", async () => {
    const first = await runSpeakAction(snapshotSpeakRetryParams({ transcript: "hello" }), {
      chatTurn: async () => ({ ok: false, dispatched: false, error: "Review required, but the original request was not retained." }),
    });
    assert.equal(first.ok, false);
    assert.equal(first.params.chatCommitted, true);
    if (!first.ok) assert.equal(speakCanRetry(first.message, first.params), false);
  });

  it("bounds ephemeral audio and answer snapshots without truncating a retry request", () => {
    const oversizedAudio = snapshotSpeakRetryParams({ inputAudio: { audioBase64: "a".repeat(MAX_AUDIO_BASE64_CHARS + 1), mime: "audio/webm" } });
    assert.equal(oversizedAudio.inputAudio, undefined);
    assert.equal(oversizedAudio.inputDeliveryUncertain, true);
    const oversizedAnswer = snapshotSpeakRetryParams({ answerRequest: { chatId: "chat", operationId: "answer", body: { text: "a".repeat(1_000_001) } } });
    assert.equal(oversizedAnswer.answerRequest, undefined);
    assert.equal(oversizedAnswer.chatCommitted, true);
    const original = { chatId: "chat", operationId: "answer", body: { messages: [{ text: "same text" }] } };
    const snapshot = snapshotSpeakRetryParams({ answerRequest: original });
    original.body.messages[0]!.text = "edited";
    assert.equal((snapshot.answerRequest!.body.messages as Array<{ text: string }>)[0]!.text, "same text");
  });

  it("does not send the chat turn again after it was committed", async () => {
    let chats = 0;
    let plays = 0;
    const first = await runSpeakAction(snapshotSpeakRetryParams({ correlationId: "c1", transcript: "what is the weather" }), {
      chatTurn: async () => {
        chats += 1;
        return { ok: true, text: "Sunny." };
      },
      synthesize: async () => ({ ok: true, audio: "aud" }),
      play: async () => {
        plays += 1;
      },
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.params.chatCommitted, true);
    const retry = await runSpeakAction(first.params, {
      chatTurn: async () => {
        chats += 1;
        return { ok: true, text: "Second." };
      },
      synthesize: async (text) => {
        assert.equal(text, "Sunny.");
        return { ok: true, audio: "aud" };
      },
      play: async () => {
        plays += 1;
      },
    });
    assert.equal(chats, 1);
    assert.equal(plays, 2);
    assert.equal(retry.ok, true);
    const wrapped = onceRetry(() => {
      chats += 10;
    });
    wrapped?.();
    wrapped?.();
    assert.equal(chats, 11);
  });

  it("no-ops when the turn was sent and there is no reply to speak", async () => {
    let chats = 0;
    const failed = await runSpeakAction(snapshotSpeakRetryParams({ correlationId: "c2", transcript: "remember this" }), {
      chatTurn: async () => {
        chats += 1;
        return { ok: false, error: "Grok returned 500. Nothing was saved as a success." };
      },
    });
    assert.equal(failed.ok, false);
    if (failed.ok) return;
    assert.equal(failed.params.chatCommitted, true);
    const again = await runSpeakAction(failed.params, {
      chatTurn: async () => {
        chats += 1;
        return { ok: true, text: "nope" };
      },
    });
    assert.equal(chats, 1);
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.noop, true);
  });

  it("retry params deep-equal the original untrimmed text, message id, and voice", () => {
    const original = {
      correlationId: "corr-1",
      chatCommitted: true,
      transcript: "  hello \n",
      reply: "  Sunny.  ",
      audio: " aud ",
      text: "  Speak this exactly \n",
      messageId: "msg-42",
      voiceId: "Ara ",
    };
    assert.deepEqual(snapshotSpeakRetryParams(original), original);
  });
});
