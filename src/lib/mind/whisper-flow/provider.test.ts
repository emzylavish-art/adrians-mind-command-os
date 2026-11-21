import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectSttProvider, transcribeWhisperFlowAudio } from "./provider.ts";

describe("whisper-flow provider", () => {
  it("prefers xAI when both keys exist", () => {
    const selected = selectSttProvider({
      XAI_VOICE_API_KEY: "xai-test",
      OPENAI_API_KEY: "sk-test",
    }, "auto", "/dev/null");
    assert.equal(selected.provider, "xai");
  });

  it("falls back to OpenAI Whisper when xAI missing", () => {
    const selected = selectSttProvider({ OPENAI_API_KEY: "sk-test" }, "auto", "/dev/null");
    assert.equal(selected.provider, "openai");
  });

  it("returns honest error when no key", () => {
    const selected = selectSttProvider({}, "auto", "/dev/null");
    assert.equal(selected.provider, null);
    if (!selected.provider) assert.match(selected.error, /No speech-to-text key is configured/i);
  });

  it("does not invent text when provider returns empty", async () => {
    const result = await transcribeWhisperFlowAudio({
      bytes: new Uint8Array([1, 2, 3, 4]),
      env: { XAI_VOICE_API_KEY: "xai-test" },
      secretsPath: "/dev/null",
      fetchImpl: async () =>
        new Response(JSON.stringify({ text: "   " }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(result.ok, false);
  });
});
