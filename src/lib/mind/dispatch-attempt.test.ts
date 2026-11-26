import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchContext, dispatchSettlement, financialProviderId, reserveDispatchAttempt, runSettledDispatch, type DispatchOutcome } from "./dispatch-attempt.ts";
import { validateMonetaryContext } from "./financial-policy.ts";
import { relayModelStream } from "./relay.ts";

test("primary and helper reservations share a task but bind exact distinct arguments and identities", () => {
  const base = { operationId: "send-a", taskId: "send-a", projectId: "project-a", provider: "openrouter", model: "fixture/model:free", args: { text: "Synthetic input" }, textOnly: true };
  const primary = dispatchContext({ ...base, stage: "primary" });
  const helper = dispatchContext({ ...base, stage: "helper-review" });
  assert.equal(primary.taskId, helper.taskId);
  assert.notEqual(primary.operationId, helper.operationId);
  assert.equal(primary.requestHash, helper.requestHash);
  assert.deepEqual(dispatchContext({ ...base, stage: "primary" }), primary);
  assert.notEqual(dispatchContext({ ...base, stage: "primary", args: { text: "Changed input" } }).requestHash, primary.requestHash);
  assert.equal(validateMonetaryContext(primary), true);
  assert.equal(JSON.stringify(primary).includes("Synthetic input"), false);
  assert.equal(financialProviderId("grok"), "xai");
  assert.equal(financialProviderId("nemotron"), "openrouter");
  assert.equal(financialProviderId("custom:11111111-1111-4111-8111-111111111111:encoded-model"), "custom:11111111-1111-4111-8111-111111111111");
  const long = "helper-" + "same-prefix".repeat(10);
  assert.notEqual(dispatchContext({ ...base, stage: long + "a" }).operationId, dispatchContext({ ...base, stage: long + "b" }).operationId);
});

test("settlement never manufactures zero USD from absent or invalid money", () => {
  assert.deepEqual(dispatchSettlement({ ok: true }), { outcome: "completed" });
  assert.deepEqual(dispatchSettlement({ ok: false }), { outcome: "unknown" });
  assert.deepEqual(dispatchSettlement({ ok: false, dispatched: false }), { outcome: "not_sent" });
  assert.deepEqual(dispatchSettlement({ ok: true, actualCostMicros: 0, currency: "USD", requestId: "provider-request" }), { outcome: "completed", actualCostMicros: 0, currency: "USD", providerRequestId: "provider-request" });
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(dispatchSettlement({ ok: true, actualCostMicros: value, currency: "USD" }).actualCostMicros, undefined);
  assert.equal(dispatchSettlement({ ok: true, actualCostMicros: 100, currency: "EUR" }).actualCostMicros, undefined);
});

test("a failed budget makes no provider call and settlement reporting cannot hide a delivered result", async () => {
  const context = dispatchContext({ operationId: "a", provider: "xai", model: "fixture", stage: "answer", args: {} });
  let calls = 0;
  const denied = await reserveDispatchAttempt("owner", context, async (owner, observed) => {
    assert.equal(owner, "owner"); assert.deepEqual(observed, context);
    return { ok: false, error: "Fixture limit", status: 429 };
  });
  if (denied.ok) await runSettledDispatch("owner", denied.reservationId, async () => { calls++; return { ok: true }; });
  assert.equal(calls, 0);
  const answer = await runSettledDispatch("owner", "reservation", async () => ({ ok: true, text: "Observed answer" }), async () => { throw new Error("Fixture settlement outage"); });
  assert.equal(answer.text, "Observed answer");
  let outcome: string | undefined;
  await assert.rejects(runSettledDispatch("owner", "reservation", async () => { throw new Error("Fixture network loss"); }, async (_owner, _id, receipt) => { outcome = receipt.outcome; }), /network loss/);
  assert.equal(outcome, "unknown");
});

test("streamed primary settles once for completion and a pre-send cancellation releases only that unsent reservation", async () => {
  for (const aborted of [false, true]) {
    const controller = new AbortController(); if (aborted) controller.abort();
    const receipts: DispatchOutcome[] = []; let sends = 0;
    const response = relayModelStream({ apiKey: "fixture", model: "fixture", messages: [{ role: "user", content: "Fixture" }], usedIds: [], requestSignal: controller.signal,
      fetchImpl: async () => { sends++; return new Response('data: {"choices":[{"delta":{"content":"Fixture answer"}}]}\n\ndata: [DONE]\n\n', { headers: { "x-request-id": "fixture-request" } }); },
      onSettled: async result => { receipts.push(result); },
    });
    await response.text();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].ok, !aborted);
    assert.equal(receipts[0].dispatched, !aborted);
    assert.equal(sends, aborted ? 0 : 1);
    assert.equal(receipts[0].actualCostMicros, undefined);
  }
});
