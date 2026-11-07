import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runSpeakAction, snapshotSpeakRetryParams } from "./speak-action.ts";

describe("mocked Speak loop", () => {
  it("runs mic, STT, chat append, TTS, and playback with no network", async () => {
    const previous = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("network was called");
    }) as typeof fetch;
    const thread: { role: "user" | "assistant"; content: string }[] = [];
    const order: string[] = [];
    try {
      const result = await runSpeakAction(snapshotSpeakRetryParams({ correlationId: "e2e-1" }), {
        capture: async () => {
          order.push("mic");
          return { ok: true, audioBase64: "bWlj" };
        },
        transcribe: async (audioBase64) => {
          order.push("stt");
          assert.equal(audioBase64, "bWlj");
          return { ok: true, text: "what is the weather" };
        },
        chatTurn: async (transcript) => {
          order.push("chat");
          thread.push({ role: "user", content: transcript });
          const reply = "It is sunny.";
          thread.push({ role: "assistant", content: reply });
          return { ok: true, text: reply };
        },
        synthesize: async (text) => {
          order.push("tts");
          assert.equal(text, "It is sunny.");
          return { ok: true, audio: "dHRz" };
        },
        play: async (audio) => {
          order.push("play");
          assert.equal(audio, "dHRz");
        },
      });
      assert.equal(result.ok, true);
      assert.deepEqual(order, ["mic", "stt", "chat", "tts", "play"]);
      assert.deepEqual(thread, [
        { role: "user", content: "what is the weather" },
        { role: "assistant", content: "It is sunny." },
      ]);
      assert.equal(fetches, 0);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
