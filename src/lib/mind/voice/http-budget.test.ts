import assert from "node:assert/strict";
import { test } from "node:test";
import { handleVoiceSession, handleVoiceStt, handleVoiceTts, type VoiceHttpDeps } from "./http.server.ts";
import { resetMindRateLimitsForTests } from "../limits.ts";

const request = (body: Record<string, unknown>) => new Request("http://fixture.test/api/mind/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const audio = Buffer.alloc(40).toString("base64");
test("STT and TTS enforce the account dispatch budget before the exact selected adapter", async () => {
  resetMindRateLimitsForTests();
  for (const kind of ["stt", "tts"] as const) {
    const handler = kind === "stt" ? handleVoiceStt : handleVoiceTts;
    const body = kind === "stt" ? { provider: "openai", audioBase64: audio, mime: "audio/wav" } : { provider: "openai", text: "Fixture reply" };
    let reserves = 0, sends = 0;
    const deps: VoiceHttpDeps = { requireUser: async () => `fixture-${kind}`, halted: async () => false, env: { OPENAI_API_KEY: "synthetic-key" }, reserve: async owner => { assert.equal(owner, `fixture-${kind}`); reserves++; return { ok: false, error: "Fixture budget exhausted", status: 429 }; }, fetchImpl: async () => { sends++; return Response.json({ text: "unexpected" }); } };
    const blocked = await handler(request(body), deps);
    assert.equal(blocked.status, 429); assert.equal(reserves, 1); assert.equal(sends, 0);
    assert.equal((await blocked.json()).dispatched, false);
    const result = await handler(request(body), { ...deps, reserve: async () => { reserves++; return { ok: true }; }, fetchImpl: async url => {
      sends++; assert.match(String(url), /^https:\/\/api\.openai\.com\/v1\/audio\//);
      return kind === "stt" ? Response.json({ text: "Fixture transcript" }) : new Response(new Uint8Array(64), { headers: { "content-type": "audio/mpeg" } });
    } });
    const output = await result.json(); assert.equal(output.ok, true); assert.equal(output.provider, "OpenAI"); assert.equal(reserves, 2); assert.equal(sends, 1);
  }
});

test("invalid input, missing selected credential and free-only requests consume no dispatch reservation", async () => {
  resetMindRateLimitsForTests(); let reserves = 0, sends = 0;
  const deps: VoiceHttpDeps = { requireUser: async () => "fixture-invalid", halted: async () => false, env: {}, reserve: async () => { reserves++; return { ok: true }; }, fetchImpl: async () => { sends++; return new Response(); } };
  for (const body of [{ provider: "openai", text: "" }, { provider: "openai", text: "Fixture" }, { provider: "openai", text: "Fixture", freeOnly: true }]) {
    const result = await (await handleVoiceTts(request(body), deps)).json();
    assert.equal(result.ok, false); assert.equal(result.dispatched, false);
  }
  assert.equal(reserves, 0); assert.equal(sends, 0);
});

test("speech gates explicitly distinguish known-unsent requests from failed provider outcomes", async () => {
  resetMindRateLimitsForTests(); let sends = 0;
  const deps: VoiceHttpDeps = { requireUser: async () => "receipt-owner", halted: async () => false, env: { OPENAI_API_KEY: "synthetic-key" }, reserve: async () => ({ ok: true }), fetchImpl: async () => { sends++; return Response.json({ error: { message: "synthetic rejection" } }, { status: 503 }); } };
  const valid = { provider: "openai", audioBase64: audio, mime: "audio/wav" };
  for (const [incoming, overrides] of [
    [new Request("http://fixture.test/api/mind/voice"), {}],
    [new Request("http://fixture.test/api/mind/voice", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }), {}],
    [request(valid), { requireUser: async () => { throw new Error("Unauthorized"); } }],
    [request(valid), { halted: async () => true }],
    [request({ ...valid, audioBase64: "invalid base64" }), {}],
    [request(valid), { env: {} }],
    [request({ ...valid, freeOnly: true }), {}],
  ] as [Request, Partial<VoiceHttpDeps>][]) {
    const result = await (await handleVoiceStt(incoming, { ...deps, ...overrides })).json();
    assert.equal(result.ok, false); assert.equal(result.dispatched, false);
  }
  assert.equal(sends, 0);
  const approvalId = "a".repeat(64);
  const pending = await (await handleVoiceStt(request(valid), { ...deps, reserve: async () => ({ ok: false, error: "Review exact audio", status: 409, approvalId }) })).json();
  assert.equal(pending.approvalId, approvalId); assert.equal(pending.dispatched, false); assert.equal(sends, 0);
  const failed = await (await handleVoiceStt(request(valid), deps)).json();
  assert.equal(failed.ok, false); assert.equal(failed.dispatched, undefined); assert.equal(sends, 1);
});

test("realtime session mint respects the same owner dispatch budget and does not expose a secret", async () => {
  resetMindRateLimitsForTests(); let sends = 0;
  const deps: VoiceHttpDeps = { requireUser: async () => "fixture-live", halted: async () => false, env: { XAI_API_KEY: "synthetic-key" }, reserve: async () => ({ ok: false, error: "Fixture budget exhausted", status: 429 }), fetchImpl: async () => { sends++; return Response.json({ value: "synthetic-ephemeral", expires_at: Math.floor(Date.now() / 1000) + 300 }); } };
  assert.equal((await handleVoiceSession(request({}), deps)).status, 429); assert.equal(sends, 0);
  const result = await handleVoiceSession(request({}), { ...deps, reserve: async () => ({ ok: true }) });
  const output = await result.json(); assert.equal(output.ok, true); assert.equal(output.value, undefined); assert.equal(sends, 1);
});

test("speech reservations bind the selected connection, explicit operation and actual dispatched model", async () => {
  resetMindRateLimitsForTests();
  const custom = "custom:11111111-1111-4111-8111-111111111111";
  const receipts: import("../financial-policy.ts").MonetarySettlement[] = [];
  const result = await handleVoiceStt(request({ provider: custom, operationId: "voice-operation", taskId: "voice-turn", audioBase64: audio, mime: "audio/wav" }), {
    requireUser: async () => "voice-owner", halted: async () => false,
    customCredential: async () => ({ ok: true, provider: "openai", key: "synthetic-key" }),
    reserve: async (owner, context) => { assert.equal(owner, "voice-owner"); assert.equal(context.provider, custom); assert.equal(context.model, "gpt-4o-mini-transcribe"); assert.equal(context.operationId, "voice-operation:stt"); assert.equal(context.taskId, "voice-turn"); assert.equal(context.textOnly, false); assert.equal(JSON.stringify(context).includes(audio), false); return { ok: true, reservationId: "speech-reservation" }; },
    settle: async (_owner, id, receipt) => { assert.equal(id, "speech-reservation"); receipts.push(receipt); },
    fetchImpl: async () => Response.json({ text: "Fixture transcript" }),
  });
  assert.equal((await result.json()).ok, true);
  assert.deepEqual(receipts, [{ outcome: "completed" }]);
});

test("model-less xAI TTS and realtime contracts remain unknown to monetary pricing", async () => {
  resetMindRateLimitsForTests(); let sends = 0;
  const deps: VoiceHttpDeps = {
    requireUser: async () => "model-less", halted: async () => false, env: { XAI_API_KEY: "synthetic-key" },
    reserve: async (_owner, context) => { assert.equal(context.provider, "xai"); assert.equal(context.model, ""); assert.equal(context.textOnly, false); return { ok: false, error: "Explicit priced contract required", status: 402 }; },
    fetchImpl: async () => { sends++; return new Response(); },
  };
  assert.equal((await handleVoiceTts(request({ provider: "xai", text: "Fixture", operationId: "voice-tts" }), deps)).status, 402);
  assert.equal((await handleVoiceSession(request({}), deps)).status, 402);
  assert.equal(sends, 0);
});
