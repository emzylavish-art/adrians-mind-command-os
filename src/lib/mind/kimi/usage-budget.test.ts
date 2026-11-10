import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeUsage,
  reserveUsage,
  summarizeUsageBudget,
  type ReserveUsageInput,
  type UsageBudgetState,
} from "./usage-budget.ts";

const NOW = Date.UTC(2026, 10, 10, 12);
const initial: UsageBudgetState = { reservations: {} };

function request(overrides: Partial<ReserveUsageInput> = {}): ReserveUsageInput {
  return {
    ownerId: "owner-a",
    taskId: "task-1",
    providerId: "provider-a",
    model: "model-a",
    idempotencyKey: "request-1",
    reserveTokens: 80,
    dailyTokenCap: 100,
    now: NOW,
    ...overrides,
  };
}

test("reserve holds budget before dispatch and repeated idempotency keys do not double-reserve", () => {
  const first = reserveUsage(initial, request());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.reservation.status, "reserved");
  assert.deepEqual(summarizeUsageBudget(first.state, "owner-a", 100, NOW), {
    ownerId: "owner-a", utcDay: "2026-11-10", capTokens: 100,
    usedTokens: 0, heldTokens: 80, availableTokens: 20,
  });
  const duplicate = reserveUsage(first.state, request());
  assert.equal(duplicate.ok, true);
  if (!duplicate.ok) return;
  assert.equal(duplicate.duplicate, true);
  assert.equal(Object.keys(duplicate.state.reservations).length, 1);
});

test("budget cap blocks excess reservations but permits a new request after actual usage is settled", () => {
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const over = reserveUsage(reserved.state, request({ idempotencyKey: "request-2", taskId: "task-2", reserveTokens: 21 }));
  assert.equal(over.ok, false);
  if (over.ok) return;
  assert.match(over.error, /budget/);
  const settled = finalizeUsage(reserved.state, { ownerId: "owner-a", idempotencyKey: "request-1", dispatched: true, actualTokens: 50, now: NOW + 1 });
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  const next = reserveUsage(settled.state, request({ idempotencyKey: "request-3", taskId: "task-3", reserveTokens: 50, now: NOW + 2 }));
  assert.equal(next.ok, true);
});

test("cancellation with reported partial usage settles the actual count, not the reservation estimate", () => {
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const canceled = finalizeUsage(reserved.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: true, actualTokens: 23, now: NOW + 5,
  });
  assert.equal(canceled.ok, true);
  if (!canceled.ok) return;
  assert.equal(canceled.reservation.status, "settled");
  assert.equal(canceled.reservation.usedTokens, 23);
  assert.equal(summarizeUsageBudget(canceled.state, "owner-a", 100, NOW).usedTokens, 23);
});

test("dispatched cancellation without usage keeps the reservation held for reconciliation", () => {
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const pending = finalizeUsage(reserved.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: true, now: NOW + 5,
  });
  assert.equal(pending.ok, true);
  if (!pending.ok) return;
  assert.equal(pending.reservation.status, "needs_reconciliation");
  assert.equal(summarizeUsageBudget(pending.state, "owner-a", 100, NOW).heldTokens, 80);
  const blockedRelease = finalizeUsage(pending.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: false, now: NOW + 6,
  });
  assert.equal(blockedRelease.ok, false);
  const reconciled = finalizeUsage(pending.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: true, actualTokens: 37, now: NOW + 7,
  });
  assert.equal(reconciled.ok, true);
  if (reconciled.ok) assert.equal(reconciled.reservation.usedTokens, 37);
});

test("a request proven not dispatched releases the reservation", () => {
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const released = finalizeUsage(reserved.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: false, now: NOW + 1,
  });
  assert.equal(released.ok, true);
  if (!released.ok) return;
  assert.equal(released.reservation.status, "released");
  assert.equal(summarizeUsageBudget(released.state, "owner-a", 100, NOW).heldTokens, 0);
});

test("reservations are owner-scoped, exact, and reject conflicting idempotency reuse", () => {
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const conflict = reserveUsage(reserved.state, request({ model: "other-model" }));
  assert.equal(conflict.ok, false);
  const wrongOwner = finalizeUsage(reserved.state, {
    ownerId: "owner-b", idempotencyKey: "request-1", dispatched: true, actualTokens: 10,
  });
  assert.equal(wrongOwner.ok, false);
  assert.equal(summarizeUsageBudget(reserved.state, "owner-b", 100, NOW).heldTokens, 0);
});

test("reported usage beyond the estimate is recorded as billed truth and blocks further reservations", () => {
  const reserved = reserveUsage(initial, request({ reserveTokens: 20 }));
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const settled = finalizeUsage(reserved.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: true, actualTokens: 101, now: NOW + 1,
  });
  assert.equal(settled.ok, true);
  if (!settled.ok) return;
  assert.equal(summarizeUsageBudget(settled.state, "owner-a", 100, NOW).usedTokens, 101);
  assert.equal(reserveUsage(settled.state, request({ idempotencyKey: "next", taskId: "task-2", reserveTokens: 1 })).ok, false);
});

test("invalid reservations and token reports fail without mutating state", () => {
  const invalid = reserveUsage(initial, request({ reserveTokens: 0 }));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.state, initial);
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const invalidUsage = finalizeUsage(reserved.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: true, actualTokens: -1,
  });
  assert.equal(invalidUsage.ok, false);
  if (!invalidUsage.ok) assert.equal(invalidUsage.state, reserved.state);
});

test("malformed idempotency keys and out-of-range timestamps are rejected safely", () => {
  const prototypeKey = reserveUsage(initial, request({ idempotencyKey: "__proto__" }));
  assert.equal(prototypeKey.ok, false);
  const invalidDate = reserveUsage(initial, request({ now: 1e100 }));
  assert.equal(invalidDate.ok, false);
  assert.deepEqual(initial, { reservations: {} });
});

test("usage cannot be settled for a request known not to have been dispatched", () => {
  const reserved = reserveUsage(initial, request());
  assert.equal(reserved.ok, true);
  if (!reserved.ok) return;
  const result = finalizeUsage(reserved.state, {
    ownerId: "owner-a", idempotencyKey: "request-1", dispatched: false, actualTokens: 5, now: NOW + 1,
  });
  assert.equal(result.ok, false);
});
