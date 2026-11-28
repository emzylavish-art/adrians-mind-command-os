import assert from "node:assert/strict";
import test from "node:test";
import { readCue, receiveTransferredCue } from "../message-cue.ts";
import { approvedPlan, canQueuePlan } from "./queued-plan.ts";

test("an approved Work plan requires the exact current draft, scope and successful predecessor", () => {
  const first = { id: "draft", text: "Review the draft plan", paused: true };
  const grant = { itemId: first.id, text: first.text, predecessor: "operation", scope: "owner and project" };
  const done = { id: grant.predecessor, succeeded: true };
  assert.equal(approvedPlan(grant, done, grant.scope, [first]), first);
  assert.equal(approvedPlan(grant, { ...done, succeeded: false }, grant.scope, [first]), undefined);
  assert.equal(approvedPlan(grant, { ...done, id: "another" }, grant.scope, [first]), undefined);
  assert.equal(approvedPlan(grant, done, "another project", [first]), undefined);
  assert.equal(approvedPlan(grant, done, grant.scope, [{ ...first, text: "Edited" }]), undefined);
  assert.equal(approvedPlan(grant, done, grant.scope, [{ ...first, claimed: true }]), undefined);
  assert.equal(canQueuePlan({ ...first, text: " /github repos" }), false);
  assert.equal(canQueuePlan({ ...first, attachments: { images: [], file: { name: "local.txt", text: "Local" } } }), false);
});

test("a planning receipt survives queue reload but confers no send or transfer authority", () => {
  const item = { id: "claimed-draft", text: "Earlier plan", claimed: true, planningOperation: "1760000000000-77ef654a-aa23-4eca-b503-bcaf2f4d8179" };
  const [reloaded] = readCue(JSON.parse(JSON.stringify([item])));
  assert.equal(reloaded.planningOperation, item.planningOperation);
  assert.equal(canQueuePlan(reloaded), false);
  assert.equal(readCue([{ ...item, planningOperation: "/invalid/value" }])[0].planningOperation, undefined);
  assert.equal(receiveTransferredCue([], reloaded)?.[0].planningOperation, undefined);
});
