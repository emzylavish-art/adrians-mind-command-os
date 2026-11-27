import assert from "node:assert/strict";
import test from "node:test";
import { consultationResponse, providerResponse } from "./provider-response.ts";
import { consumeMindTurn, shouldStoreReply } from "./live-turn.ts";
import { normalizeTurnCallEvidence, pullMindEvents } from "./stream.ts";
import { readFileSync } from "node:fs";
import type { ConsultEvidence } from "./model-consult.ts";

const helper: ConsultEvidence = { id: "helper-selected", ok: true, text: "Observed helper answer", model: "helper-actual", provider: "fixture", usage: { prompt_tokens: 31, completion_tokens: 7 }, requestId: "helper-request", originalCharacters: 22, truncated: false };
const consume = (response: Response, signal = new AbortController().signal, onDelta: (text: string) => void = () => {}) => consumeMindTurn({ url: "/fixture", body: {}, headers: {}, signal, fetchImpl: async () => response, onDelta });

test("a primary JSON failure preserves completed helper and primary usage without a stored success", async () => {
  const response = consultationResponse(async () => Response.json({ ok: false, error: "Primary returned no assistant text", usage: { prompt_tokens: 14, completion_tokens: 0 }, provider: "primary-fixture", requestId: "primary-request" }, { status: 502 }), [helper], new AbortController().signal);
  const result = await consume(response);
  assert.equal(result.ok, false); assert.equal(shouldStoreReply(result), false);
  assert.deepEqual(result.consultation?.map((row) => row.usage), [helper.usage]);
  assert.deepEqual(result.usage, { prompt_tokens: 14, completion_tokens: 0 });
  assert.equal(result.requestId, "primary-request");
});

test("helper receipt arrives before a delayed primary and survives an error stream", async () => {
  let release!: () => void; const waiting = new Promise<void>((resolve) => { release = resolve; });
  const response = consultationResponse(async () => { await waiting; return providerResponse(async (delta) => { delta("Partial"); return { ok: false, error: "primary disconnected" }; }, () => ({ text: "wrong" }), new AbortController().signal); }, [helper], new AbortController().signal);
  const reader = response.body!.getReader();
  const first = await reader.read(); const firstText = new TextDecoder().decode(first.value);
  const events = pullMindEvents(firstText).events;
  assert.equal(events[0]?.event, "consultation");
  release();
  const reconstructed = new ReadableStream<Uint8Array>({ async start(stream) { stream.enqueue(first.value!); for (;;) { const next = await reader.read(); if (next.done) break; stream.enqueue(next.value); } stream.close(); } });
  const result = await consume(new Response(reconstructed, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(result.ok, false); assert.equal(result.consultation?.length, 1);
  assert.equal(result.consultation?.[0]?.requestId, "helper-request");
});

test("cancel after a helper receipt keeps measured helper tokens but never commits the partial answer", async () => {
  const abort = new AbortController();
  const response = new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(`event: consultation\ndata: ${JSON.stringify({ consultation: [helper] })}\n\nevent: delta\ndata: {"text":"pending"}\n\n`)); } }), { headers: { "content-type": "text/event-stream" } });
  const result = await consume(response, abort.signal, () => abort.abort());
  assert.equal(result.ok, false); assert.equal(shouldStoreReply(result), false);
  assert.equal(result.consultation?.[0]?.usage?.completion_tokens, 7);
});

test("JSON error and canceled event receipts are normalized; repeated receipts are not duplicated", async () => {
  const json = await consume(Response.json({ error: "failed", consultation: [helper], usage: { prompt_tokens: -1, completion_tokens: "200" } }, { status: 503 }));
  assert.deepEqual(json.usage, null); assert.equal(json.consultation?.length, 1);
  const canceled = await consume(new Response(`event: consultation\ndata: ${JSON.stringify({ consultation: [helper] })}\n\nevent: canceled\ndata: ${JSON.stringify({ error: "Stopped", consultation: [helper] })}\n\n`, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(canceled.consultation?.length, 1); assert.equal(shouldStoreReply(canceled), false);
});

test("EOF and successful completion retain receipts, with final consultation replacing its earlier copy", async () => {
  const initial = `event: consultation\ndata: ${JSON.stringify({ consultation: [helper] })}\n\n`;
  const ended = await consume(new Response(initial, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(ended.ok, false); assert.equal(ended.consultation?.length, 1);
  const finished = await consume(new Response(`${initial}event: done\ndata: ${JSON.stringify({ text: "Done", model: "primary", usedIds: [], consultation: [helper] })}\n\n`, { headers: { "content-type": "text/event-stream" } }));
  assert.equal(shouldStoreReply(finished), true); assert.equal(finished.consultation?.length, 1);
});

test("actual helper USD and primary pending approval survive failure without a successful message", async () => {
  const priced = { ...helper, actualCostMicros: 1250, currency: "USD" as const };
  const approvalId = "a".repeat(64);
  const response = consultationResponse(async () => Response.json({ ok: false, error: "Review exact primary request", approvalId }, { status: 409 }), [priced], new AbortController().signal);
  const result = await consume(response);
  assert.equal(result.ok, false); assert.equal(shouldStoreReply(result), false);
  if (!result.ok) assert.equal(result.approvalId, approvalId);
  if (!result.ok) { assert.equal(result.dispatched, undefined); assert.equal(result.deliveryUncertain, true); }
  assert.equal(result.consultation?.[0].actualCostMicros, 1250); assert.equal(result.consultation?.[0].currency, "USD");
});

test("only explicit whole-turn no-dispatch receipts permit exact retry through JSON or SSE", async () => {
  const approvalId = "b".repeat(64);
  for (const dispatched of [false, true, undefined, "false", 0]) {
    const payload = { ok: false, error: "Review request", approvalId, dispatched };
    const normalized = normalizeTurnCallEvidence(payload);
    assert.equal(normalized.dispatched, dispatched === false ? false : undefined);
    for (const response of [Response.json(payload, { status: 409 }), new Response(`event: error\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })]) {
      const result = await consume(response);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.approvalId, approvalId);
        assert.equal(result.dispatched, dispatched === false ? false : undefined);
        assert.equal(result.deliveryUncertain, dispatched === false ? undefined : true);
      }
    }
  }
});

test("the mounted whole-turn receipt observes helpers before primary preflight can refuse", () => {
  const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  assert.match(source, /const markDispatched = \(stage:[^)]*\) => \{ anyDispatched = true; onDispatched\(stage\); \}/);
  assert.match(source, /const markPrimaryDispatched = \(\) => \{ primaryDispatched = true; markDispatched\(\); \}/);
  assert.match(source, /askConnectedModule\(userId, id, requestText, \(\) => \{ sent = true; markDispatched\("helper"\);/);
  assert.match(source, /approvalId: reservation\.approvalId, \.\.\.\(!anyDispatched \? \{ dispatched: false \} : \{\}\)/);
});


test("a rejected primary after a completed helper cannot authorize whole-turn replay", async () => {
  const signal = new AbortController().signal;
  const response = consultationResponse(async () => providerResponse(async () => ({
    ok: false, dispatched: false, error: "Primary preflight rejected", httpStatus: 409,
  }), () => ({}), signal), [helper], signal);
  const result = await consume(response);
  assert.equal(result.ok, false);
  assert.equal(result.primaryDispatched, false);
  assert.equal(result.dispatched, undefined);
  assert.equal(result.consultation?.[0].requestId, "helper-request");
});
