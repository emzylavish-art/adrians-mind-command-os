import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANCEL_BUDGET_MAX,
  allowCancel,
  allTracksEnded,
  beginFlight,
  completeSpeak,
  createCancelBudget,
  createFlightGate,
  createSpeakQueue,
  createTranscriptDedupe,
  endFlight,
  enqueueSpeak,
  nextMuteState,
  secretNeedsRemint,
  shouldAcceptTranscript,
} from "./spam-guard.ts";

describe("spam-guard flight", () => {
  it("single-flights overlapping opens", () => {
    const g = createFlightGate();
    const a = beginFlight(g);
    assert.ok(a);
    assert.equal(beginFlight(g), null);
    endFlight(g, a!.generation);
    assert.ok(beginFlight(g));
  });
});

describe("spam-guard mute/cancel", () => {
  it("mute spam is idempotent", () => {
    assert.deepEqual(nextMuteState(false, false), { changed: false, muted: false });
    assert.deepEqual(nextMuteState(false, true), { changed: true, muted: true });
    assert.deepEqual(nextMuteState(true, true), { changed: false, muted: true });
  });

  it("caps cancels per window", () => {
    const b = createCancelBudget(1000);
    for (let i = 0; i < CANCEL_BUDGET_MAX; i++) assert.equal(allowCancel(b, 1000 + i), true);
    assert.equal(allowCancel(b, 1500), false);
    assert.equal(allowCancel(b, 1000 + 4000), true);
  });
});

describe("spam-guard transcript/speak/secret", () => {
  it("dedupes identical transcripts within TTL", () => {
    const d = createTranscriptDedupe();
    assert.equal(shouldAcceptTranscript(d, "hello", 1000), true);
    assert.equal(shouldAcceptTranscript(d, "hello", 1500), false);
    assert.equal(shouldAcceptTranscript(d, "hello", 4000), true);
    assert.equal(shouldAcceptTranscript(d, "  ", 5000), false);
  });

  it("queues overlapping speaks without double-start", () => {
    const q = createSpeakQueue();
    assert.equal(enqueueSpeak(q, "a"), "start");
    assert.equal(enqueueSpeak(q, "a"), "ignore");
    assert.equal(enqueueSpeak(q, "b"), "replace_pending");
    assert.equal(completeSpeak(q), "b");
    assert.equal(completeSpeak(q), null);
  });

  it("remints near expiry", () => {
    assert.equal(secretNeedsRemint(0, 1000), true);
    assert.equal(secretNeedsRemint(20_000, 1000, 15_000), false);
    assert.equal(secretNeedsRemint(20_000, 10_000, 15_000), true);
  });

  it("allTracksEnded", () => {
    assert.equal(allTracksEnded(null), true);
    assert.equal(allTracksEnded({ getTracks: () => [{ readyState: "ended" }] }), true);
    assert.equal(allTracksEnded({ getTracks: () => [{ readyState: "live" }] }), false);
  });
});
