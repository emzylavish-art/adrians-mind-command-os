import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleVoiceStt, handleVoiceTts } from "./http.server.ts";
import { transcribeWithFallback, speakWithFallback } from "./provider-fallback.ts";

const recording = Buffer.alloc(64, 7);
const req = (body: Record<string, unknown>) => new Request("https://fixture.local/api/mind/voice/stt", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ audioBase64: recording.toString("base64"), ...body }) });

describe("C5 explicit audio destinations", () => {
  for (const failure of [401, 429, "timeout", "empty"] as const) {
    it(`does not send the recording to another provider after ${failure} without consent`, async () => {
      const calls: string[] = [];
      const result = await transcribeWithFallback({ bytes: recording, xaiKey: "fake", openaiKey: "fake", fetchImpl: (async (url) => {
        calls.push(String(url));
        if (failure === "timeout") throw new Error("timeout");
        return new Response(JSON.stringify({ text: "" }), { status: typeof failure === "number" ? failure : 200 });
      }) as typeof fetch });
      assert.equal(result.ok, false); assert.equal(calls.length, 1); assert.match(calls[0], /api\.x\.ai/);
    });
  }
  it("selects OpenAI directly without contacting xAI, and attributes the transcript", async () => {
    const calls: string[] = [];
    const response = await handleVoiceStt(req({ provider: "openai" }), {
      requireUser: async () => "c5-stt-openai", halted: async () => false, recordUsage: async () => {}, env: { XAI_API_KEY: "fake", OPENAI_API_KEY: "fake" },
      fetchImpl: (async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ text: "hello" })); }) as typeof fetch,
    });
    assert.deepEqual(await response.json(), { ok: true, text: "hello", provider: "OpenAI" });
    assert.equal(calls.length, 1); assert.match(calls[0], /api\.openai\.com/);
  });
  it("explicit fallback is bounded to one attempt and preserves actual provider", async () => {
    const calls: string[] = [];
    const result = await transcribeWithFallback({ provider: "xai", fallbackProvider: "openai", bytes: recording, xaiKey: "fake", openaiKey: "fake", fetchImpl: (async (url) => {
      calls.push(String(url)); return String(url).includes("api.x.ai") ? new Response("", { status: 401 }) : new Response(JSON.stringify({ text: "hello" }));
    }) as typeof fetch });
    assert.equal(result.ok && result.provider, "OpenAI"); assert.equal(calls.length, 2);
  });
  it("unknown credentials are configuration failure rather than a network retry", async () => {
    const response = await handleVoiceStt(req({ provider: "openai" }), { requireUser: async () => "c5-no-key", halted: async () => false, env: {}, fetchImpl: (async () => assert.fail("no network")) as typeof fetch });
    assert.equal((await response.json()).code, "provider_not_configured");
  });
  it("free-only and invalid destination block before any upload", async () => {
    for (const body of [{ provider: "openai", freeOnly: true }, { provider: "invented" }]) {
      const response = await handleVoiceStt(req(body), { requireUser: async () => `c5-block-${body.provider}`, halted: async () => false, env: { OPENAI_API_KEY: "fake" }, fetchImpl: (async () => assert.fail("no network")) as typeof fetch });
      assert.equal((await response.json()).ok, false);
    }
  });
  it("selects OpenAI speech explicitly and never infers fallback from a configured key", async () => {
    let calls = 0;
    const fetchImpl = (async (url) => { calls++; assert.match(String(url), /api\.openai\.com/); return new Response(recording); }) as typeof fetch;
    const response = await handleVoiceTts(req({ provider: "openai", text: "answer" }), { requireUser: async () => "c5-tts-openai", halted: async () => false, recordUsage: async () => {}, env: { XAI_API_KEY: "fake", OPENAI_API_KEY: "fake" }, fetchImpl });
    assert.equal((await response.json()).provider, "OpenAI"); assert.equal(calls, 1);
    const missingXai = await speakWithFallback({ text: "answer", openaiKey: "fake", fetchImpl: (async () => assert.fail("no inferred fallback")) as typeof fetch });
    assert.equal(missingXai.ok, false);
  });
});
