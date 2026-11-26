import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageReceipt } from "../usage-ledger.ts";
import { handleVoiceSession, handleVoiceStt, handleVoiceTts, type VoiceHttpDeps } from "./http.server.ts";

const recording = Buffer.alloc(64, 7);
function request(body: Record<string, unknown> = {}) {
  return new Request("https://fixture.example/api/mind/voice/stt", {
    method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ audioBase64: recording.toString("base64"), ...body }),
  });
}
function setup(name: string, fetchImpl: typeof fetch) {
  const rows: UsageReceipt[] = [];
  const deps: VoiceHttpDeps = {
    requireUser: async () => name, halted: async () => false,
    env: { XAI_API_KEY: "fixture-secret-not-for-ledger", OPENAI_API_KEY: "fixture-secret-not-for-ledger" },
    fetchImpl,
    recordUsage: async (owner, receipt) => { assert.equal(owner, name); rows.push(structuredClone(receipt)); },
  };
  return { rows, deps };
}

test("C5 actual voice fallback records each provider attempt and only reported usage", async () => {
  let calls = 0;
  const f = setup("voice-usage-fallback", async url => {
    calls++;
    if (String(url).includes("api.x.ai")) return new Response("denied", { status: 401, headers: { "x-request-id": "xai-failed" } });
    return Response.json({ text: "PRIVATE_TRANSCRIPT_MARKER", model: "fixture-transcriber", usage: { input_tokens: 13, output_tokens: 5 } }, { headers: { "x-request-id": "openai-success" } });
  });
  const response = await handleVoiceStt(request({ provider: "xai", fallbackProvider: "openai" }), f.deps);
  assert.deepEqual(await response.json(), { ok: true, text: "PRIVATE_TRANSCRIPT_MARKER", provider: "OpenAI" });
  assert.equal(calls, 2);
  const final = f.rows.filter(row => row.dispatched);
  assert.equal(final.length, 2);
  assert.equal(final[0].provider, "xai"); assert.equal(final[0].outcome, "failed");
  assert.equal(final[0].requestId, "xai-failed"); assert.equal(final[0].promptTokens, null);
  assert.equal(final[1].provider, "openai"); assert.equal(final[1].outcome, "completed");
  assert.equal(final[1].providerDispatch, "sent");
  assert.equal(final[1].requestedModel, "gpt-4o-mini-transcribe"); assert.equal(final[1].model, "fixture-transcriber");
  assert.equal(final[1].requestId, "openai-success"); assert.equal(final[1].promptTokens, 13); assert.equal(final[1].completionTokens, 5);
  assert.equal(final[0].operationId, final[1].operationId); assert.notEqual(final[0].stage, final[1].stage);
  assert.ok(f.rows.every(row => row.channel === "speak"));
  const ledger = JSON.stringify(f.rows);
  for (const privateValue of ["PRIVATE_TRANSCRIPT_MARKER", "fixture-secret-not-for-ledger", recording.toString("base64")]) assert.ok(!ledger.includes(privateValue));
});

test("C5 missing initial speech journal blocks both primary and fallback dispatch", async () => {
  let calls = 0;
  const f = setup("voice-usage-before", async () => { calls++; return Response.json({ text: "must not run" }); });
  f.deps.recordUsage = async () => { throw new Error("fixture storage down"); };
  const response = await handleVoiceStt(request({ provider: "xai", fallbackProvider: "openai" }), f.deps);
  assert.equal(response.status, 503); assert.match((await response.json()).error, /not sent.*usage record/);
  assert.equal(calls, 0);
});

test("C5 final speech journal failure preserves successful provider response without replay", async () => {
  let calls = 0, writes = 0;
  const f = setup("voice-usage-after", async () => { calls++; return Response.json({ text: "heard once" }); });
  f.deps.recordUsage = async (_owner, receipt) => { writes++; if (writes > 1) throw new Error("fixture final write unavailable"); f.rows.push(receipt); };
  const response = await handleVoiceStt(request({ provider: "openai" }), f.deps);
  assert.deepEqual(await response.json(), { ok: true, text: "heard once", provider: "OpenAI" });
  assert.equal(calls, 1); assert.equal(writes, 2);
  assert.equal(f.rows[0].outcome, "unconfirmed"); assert.equal(f.rows[0].promptTokens, null);
});

test("C5 timed out speech remains a distinct unconfirmed execution with unknown consumption", async () => {
  let calls = 0;
  const f = setup("voice-usage-timeout", async () => { calls++; throw new Error("fixture timeout"); });
  const response = await handleVoiceStt(request({ provider: "openai" }), f.deps);
  assert.equal((await response.json()).ok, false); assert.equal(calls, 1);
  assert.equal(f.rows.at(-1)?.dispatched, true); assert.equal(f.rows.at(-1)?.outcome, "unconfirmed");
  assert.equal(f.rows.at(-1)?.promptTokens, null); assert.equal(f.rows.at(-1)?.completionTokens, null);
});

test("C5 speech output records actual destination without storing text/audio or guessing tokens", async () => {
  const f = setup("voice-usage-output", async () => new Response(recording, { headers: { "x-request-id": "speech-request" } }));
  const response = await handleVoiceTts(request({ provider: "openai", text: "PRIVATE_TTS_MARKER" }), f.deps);
  assert.equal((await response.json()).provider, "OpenAI");
  const final = f.rows.at(-1)!;
  assert.equal(final.provider, "openai"); assert.equal(final.requestedModel, "gpt-4o-mini-tts");
  assert.equal(final.model, "unknown"); assert.equal(final.requestId, "speech-request");
  assert.equal(final.promptTokens, null); assert.equal(final.completionTokens, null);
  assert.ok(!JSON.stringify(f.rows).includes("PRIVATE_TTS_MARKER"));
  assert.ok(!JSON.stringify(f.rows).includes(recording.toString("base64")));
});

test("C5 native realtime authorization never claims a completed voice call or known tokens", async () => {
  const f = setup("voice-usage-native", async () => Response.json({ value: "ephemeral-private-secret", expires_at: Date.now() / 1000 + 300 }));
  const response = await handleVoiceSession(request(), f.deps);
  assert.equal((await response.json()).ok, true);
  const final = f.rows.at(-1)!;
  assert.match(final.stage, /^realtime-session:/); assert.equal(final.outcome, "unconfirmed");
  assert.equal(final.providerDispatch, "unknown");
  assert.equal(final.promptTokens, null); assert.equal(final.completionTokens, null);
  assert.ok(!JSON.stringify(f.rows).includes("ephemeral-private-secret"));
});

test("C5 locally blocked speech creates no execution receipt and independent requests stay separate", async () => {
  const f = setup("voice-usage-local", async () => Response.json({ text: "heard" }));
  assert.equal((await (await handleVoiceStt(request({ freeOnly: true }), f.deps)).json()).ok, false);
  assert.equal(f.rows.length, 0);
  await handleVoiceStt(request({ provider: "openai" }), f.deps);
  await handleVoiceStt(request({ provider: "openai" }), f.deps);
  const final = f.rows.filter(row => row.dispatched);
  assert.equal(final.length, 2); assert.notEqual(final[0].operationId, final[1].operationId);
});
