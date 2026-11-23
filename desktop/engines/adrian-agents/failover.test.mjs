import assert from "node:assert/strict";
import test from "node:test";
import { beforeSharedSend, claimTask, finishInFlight, freshHandoff, missed, pcObservePhone, phoneObservePc, reclaim, wakeSignal, HEARTBEAT_MS } from "./failover.mjs";

test("two missed heartbeats promote the phone and the PC stays primary when the phone is quiet", () => {
  const now = 100000;
  assert.equal(missed(now, now - HEARTBEAT_MS), false);
  assert.equal(missed(now, now - HEARTBEAT_MS * 2), true);
  const pc = pcObservePhone(freshHandoff(), now, now - HEARTBEAT_MS * 2);
  assert.equal(pc.owner, "pc");
  assert.equal(pc.phoneDown, true);
  const phone = phoneObservePc(freshHandoff(), now, now - HEARTBEAT_MS * 2);
  assert.equal(phone.owner, "phone");
  assert.equal(phone.phone, "promoted");
});

test("an in-flight task is not reclaimed or sent twice", () => {
  let state = phoneObservePc(freshHandoff(), 100000, 0);
  state = claimTask(state, { id: "m1", kind: "email-queue" });
  assert.equal(state.inFlight.owner, "phone");
  assert.equal(reclaim(state, 120000).phone, "handoff-pending");
  assert.equal(beforeSharedSend(state, "pc", "m1").refused, "Read the handoff first. This machine does not own shared messages.");
  const sent = beforeSharedSend(state, "phone", "m1");
  assert.equal(beforeSharedSend(sent, "phone", "m1").refused, "That send already happened.");
  state = finishInFlight(sent);
  assert.equal(reclaim(state, 130000).owner, "pc");
  assert.equal(wakeSignal().executes, false);
});
