import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySpeakFailure,
  onceRetry,
  runSpeakAction,
  sanitizeSpeakMessage,
  snapshotSpeakRetryParams,
} from "./speak-action.ts";

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
