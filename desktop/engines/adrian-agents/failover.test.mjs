import assert from "node:assert/strict";
import test from "node:test";
import { beforeSharedSend, claimTask, compareAndSet, emailScope, finishInFlight, freshHandoff, freshTask, heartbeat, irreversibleAction, missed, modelProposal, pcObservePhone, phoneObservePc, reclaim, renewLease, statusView, telegramNotice, wakeSignal, watchdog, HEARTBEAT_MS, LEASE_MS } from "./failover.mjs";

test("two missed heartbeats promote the phone and the PC stays primary when the phone is quiet", () => {
  const now = 100000;
  assert.equal(missed(now, now - HEARTBEAT_MS), false);
  assert.equal(missed(now, now - HEARTBEAT_MS * 2), true);
  const pc = pcObservePhone(freshHandoff(now), now, now - HEARTBEAT_MS * 2);
  assert.equal(pc.owner, "pc");
  assert.equal(pc.phoneDown, true);
  const phone = phoneObservePc(freshHandoff(now), now, now - HEARTBEAT_MS * 2);
  assert.equal(phone.owner, "phone");
  assert.equal(phone.phone, "promoted");
});

test("an in-flight task is not reclaimed or sent twice", () => {
  let state = phoneObservePc(freshHandoff(0), 100000, 0);
  state = claimTask(state, { id: "m1", kind: "email-queue" });
  assert.equal(state.inFlight.claimed_by, "phone");
  assert.equal(reclaim(state, 120000).phone, "handoff-pending");
  assert.equal(beforeSharedSend(state, "pc", "m1").refused, "Read the handoff first. This machine does not own shared messages.");
  const sent = beforeSharedSend(state, "phone", "m1");
  assert.equal(beforeSharedSend(sent, "phone", "m1").refused, "That send already happened.");
  state = finishInFlight(sent);
  assert.equal(reclaim(state, 130000).owner, "pc");
  assert.equal(wakeSignal().deviceToDevice, false);
  assert.match(irreversibleAction("send", false).refused, /review folder/);
});

test("chaos: a lost lease stops the PC and the watchdog does not duplicate a send", () => {
  const now = 200000;
  let row = freshHandoff(0);
  const cut = renewLease(row, "pc", now);
  assert.equal(cut.stopped, true);
  const flipped = watchdog(row, now, 0, now);
  assert.equal(flipped.alert, "phone-primary");
  assert.equal(flipped.row.owner, "phone");
  assert.equal(flipped.row.epoch, 2);
  const again = compareAndSet(row, 1, { owner: "phone" }, now);
  assert.equal(watchdog(again, now, 0, now).row.owner, "phone");
  let state = { ...flipped.row, inFlight: null, sends: [], events: [] };
  state = claimTask(state, freshTask("m2", "message-triage"));
  state = beforeSharedSend(state, "phone", "m2");
  assert.equal(beforeSharedSend(state, "phone", "m2").refused, "That send already happened.");
  assert.equal(beforeSharedSend(state, "pc", "m2").refused, "Read the handoff first. This machine does not own shared messages.");
  assert.equal(beforeSharedSend({ ...state, owner: "pc" }, "pc", "m2").refused, "That send already happened.");
  const both = watchdog(freshHandoff(0), now, 0, 0);
  assert.equal(both.alert, "dead-man");
  assert.equal(telegramNotice(2, 1, "PC down").refused, "That Telegram user is not on the allowlist.");
  assert.equal(telegramNotice(1, 1, "PC down").deviceToDevice, false);
  assert.equal(modelProposal("draft").executes, false);
  assert.equal(emailScope().send, false);
  assert.equal(heartbeat("pc", now, now + 10, "ok", true).goingDown, true);
  assert.equal(statusView(flipped.row, now, 0, now).iosBackgroundWakeAssumed, false);
  assert.equal(statusView(flipped.row, now, 0, now).measuredFailoverMs, null);
  assert.equal(renewLease(flipped.row, "pc", now + LEASE_MS).stopped, true);
});
