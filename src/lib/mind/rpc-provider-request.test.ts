import test from "node:test";
import assert from "node:assert/strict";
import { rpcDispatchContext, rpcOperationId, runOwnerProviderRequest } from "./rpc-provider-request.server.ts";
import type { MonetarySettlement } from "./financial-policy.ts";

const context = rpcDispatchContext({ operationId: "voice-1:output", provider: "custom:owner-openai", model: "gpt-4o-mini-tts", textOnly: false }, { text: "fixture answer", voiceId: "alloy" });

test("budget refusal preserves the exact retry identity and calls no provider or settlement", async () => {
  let sent = 0, settled = 0;
  const result = await runOwnerProviderRequest("owner-a", context, async () => { sent++; return { ok: true }; }, {
    reserve: async (owner, _sql, _now, value) => { assert.equal(owner, "owner-a"); assert.deepEqual(value, context); return { ok: false, error: "Review this operation", status: 409, approvalId: "approval-1" }; },
    settle: async () => { settled++; return { ok: true }; },
  });
  assert.deepEqual(result, { ok: false, dispatched: false, error: "Review this operation", operationId: "voice-1:output", approvalId: "approval-1" });
  assert.equal(sent, 0); assert.equal(settled, 0);
});

test("successful speech retains an unknown dollar hold instead of inventing zero or token prices", async () => {
  const receipts: MonetarySettlement[] = [];
  const result = await runOwnerProviderRequest("owner-a", context, async () => ({ ok: true, audio: "fixture-audio", provider: "OpenAI" }), {
    reserve: async () => ({ ok: true, reservationId: "hold-1" }),
    settle: async (owner, id, receipt) => { assert.equal(owner, "owner-a"); assert.equal(id, "hold-1"); receipts.push(receipt); return { ok: true }; },
  });
  assert.equal(result.ok, true); assert.deepEqual(receipts, [{ outcome: "completed" }]);
  assert.ok(!("actualCostMicros" in receipts[0]));
});

test("ambiguous provider failure never releases a monetary hold", async () => {
  const receipts: MonetarySettlement[] = [];
  const deps = { reserve: async () => ({ ok: true as const, reservationId: "hold-1" }), settle: async (_owner: string, _id: string | undefined, receipt: MonetarySettlement) => { receipts.push(receipt); return { ok: true }; } };
  await assert.rejects(() => runOwnerProviderRequest("owner-a", context, async () => { throw new TypeError("connection closed"); }, deps), /connection closed/);
  const result = await runOwnerProviderRequest("owner-a", { ...context, operationId: "voice-2:output" }, async () => ({ ok: false, error: "unconfirmed" }), deps);
  assert.equal(result.ok, false); assert.deepEqual(receipts, [{ outcome: "unknown" }, { outcome: "unknown" }]);
});

test("settlement outage preserves a completed response and exposes pending bookkeeping", async () => {
  for (const throws of [false, true]) {
    const result = await runOwnerProviderRequest("owner-a", context, async () => ({ ok: true, audio: "already-generated" }), {
      reserve: async () => ({ ok: true, reservationId: "hold-1" }),
      settle: async () => { if (throws) throw new Error("database unavailable"); return { ok: false, error: "database unavailable" }; },
    });
    assert.equal(result.ok, true); assert.equal("financialReceiptPending" in result && result.financialReceiptPending, true);
    assert.equal("audio" in result && result.audio, "already-generated");
  }
});

test("request fingerprints bind voice content, model and route without storing source arguments", () => {
  const second = rpcDispatchContext({ ...context }, { text: "changed answer", voiceId: "alloy" });
  assert.match(context.requestHash!, /^[a-f0-9]{64}$/); assert.notEqual(second.requestHash, context.requestHash);
  assert.ok(!JSON.stringify(context).includes("fixture answer"));
  assert.equal(rpcOperationId("voice-1:output", "speech"), "voice-1:output");
  assert.match(rpcOperationId("bad\nidentity", "speech"), /^speech:[0-9a-f-]{36}$/);
});
