import assert from "node:assert/strict";
import { test } from "node:test";
import { runGovernedHostedCoding } from "./resource-dispatch.server.ts";
test("hosted coding policy denial never starts the process", async () => {
  let dispatched = 0;
  await assert.rejects(runGovernedHostedCoding("owner-a", async () => { dispatched++; return { ok: true }; }, (r) => r.ok, {
    authorize: async () => { throw new Error("Account Free-only policy blocks this route."); },
  }), /Free-only/);
  assert.equal(dispatched, 0);
});
test("hosted coding preserves task identity and distinguishes success from unknown usage", async () => {
  const captured: unknown[] = [];
  const authorize = async (...args: (string | boolean)[]) => { captured.push(args); return async (ok: boolean) => { captured.push(ok); }; };
  const result = await runGovernedHostedCoding("owner-a", async () => ({ ok: true, output: "fixture" }), (r) => r.ok, { authorize, taskId: "fixture-task" });
  assert.deepEqual(captured, [["owner-a", "hosted-acp", "runtime-selected", "fixture-task", false, true], true]);
  assert.equal(result.resourceReceipt.taskId, "fixture-task");
  assert.equal(result.resourceReceipt.cost, "unknown");
  assert.match(result.resourceReceipt.scope, /not metered/);
  await runGovernedHostedCoding("owner-a", async () => ({ ok: false }), (r) => r.ok, { authorize });
  assert.equal(captured.at(-1), false);
  await assert.rejects(runGovernedHostedCoding("owner-a", async () => { throw new Error("transport interrupted"); }, () => false, { authorize }), /transport interrupted/);
  assert.equal(captured.at(-1), false);
});
