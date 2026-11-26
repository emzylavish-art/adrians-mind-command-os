import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithFallback } from "./provider-fallback.ts";
import { handleVoiceStt } from "./http.server.ts";
import { parseTranscriptionPolicy, readTranscriptionPolicy, transcriptionPolicyKey } from "./transcription-policy.ts";

test("default transcription failure never discloses audio to a configured second provider", async () => {
  const urls: string[] = [];
  const result = await transcribeWithFallback({ bytes: new Uint8Array(80), xaiKey: "fake-a", openaiKey: "fake-b", fetchImpl: (async (url) => { urls.push(String(url)); return Response.json({}, { status: 401 }); }) as typeof fetch });
  assert.equal(urls.length, 1); assert.match(urls[0]!, /api.x.ai/); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "provider_rejected");
});
test("approved alternate records both attempts while silence does not trigger another recipient", async () => {
  for (const silence of [true, false]) {
    const urls: string[] = [];
    const result = await transcribeWithFallback({ bytes: new Uint8Array(80), xaiKey: "fake-a", openaiKey: "fake-b", policy: { provider: "xai", allowFallback: true }, fetchImpl: (async (url) => {
      urls.push(String(url)); return urls.length === 1 ? Response.json({ text: "" }, { status: silence ? 200 : 429 }) : Response.json({ text: "fixture words" });
    }) as typeof fetch });
    assert.equal(urls.length, silence ? 1 : 2);
    if (!silence) { assert.equal(result.ok, true); assert.equal(result.provider, "OpenAI"); assert.equal(result.attempts.length, 2); }
  }
});
test("actual STT HTTP entry point applies selected recipient, attribution, malformed policy and free-only", async () => {
  let calls = 0;
  const deps = { recordUsage: async () => {}, reserve: async () => ({ ok: true as const }), requireUser: async () => `fixture-${crypto.randomUUID()}`, halted: async () => false, authorize: async () => async () => {}, env: { XAI_API_KEY: "fake-a", OPENAI_API_KEY: "fake-b" }, fetchImpl: (async (url: string | URL | Request) => { calls++; assert.match(String(url), /api.openai.com/); return Response.json({ text: "synthetic" }); }) as typeof fetch };
  const request = (extra: object) => new Request("https://app.example/api/mind/voice/stt", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ audioBase64: Buffer.alloc(80).toString("base64"), mime: "audio/wav", ...extra }) });
  const ok = await (await handleVoiceStt(request({ transcriptionPolicy: { provider: "openai", allowFallback: false } }), deps)).json();
  assert.equal(ok.provider, "OpenAI"); assert.equal(calls, 1);
  assert.equal((await handleVoiceStt(request({ transcriptionPolicy: { provider: "unknown" } }), deps)).status, 400);
  await handleVoiceStt(request({ freeOnly: true }), deps); assert.equal(calls, 1);
});
test("invalid settings fail closed and account preferences do not cross", () => {
  assert.equal(parseTranscriptionPolicy({ provider: "xai", allowFallback: "yes" }), null);
  const stored = new Map([[transcriptionPolicyKey("a"), '{"provider":"openai","allowFallback":true}']]);
  const storage = { getItem: (key: string) => stored.get(key) ?? null };
  assert.equal(readTranscriptionPolicy(storage, "a").provider, "openai");
  assert.deepEqual(readTranscriptionPolicy(storage, "b"), { provider: "xai", allowFallback: false });
});
