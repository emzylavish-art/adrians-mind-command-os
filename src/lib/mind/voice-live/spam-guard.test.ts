import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowCancel,
  beginFlight,
  createCancelBudget,
  createFlightGate,
  createTranscriptDedupe,
  endFlight,
  MAX_RECONNECT_ATTEMPTS,
  nextReconnectDelayMs,
  shouldAcceptTranscript,
} from "./spam-guard.ts";

describe("voice-live spam-guard", () => {
  it("single-flight blocks double start", () => {
    const gate = createFlightGate();
    const a = beginFlight(gate);
    assert.ok(a);
    assert.equal(beginFlight(gate), null);
    endFlight(gate, a!.generation);
    assert.ok(beginFlight(gate));
  });

  it("cancel budget caps barge-in spam", () => {
    const budget = createCancelBudget(1000);
    for (let i = 0; i < 8; i++) assert.equal(allowCancel(budget, 1000 + i), true);
    assert.equal(allowCancel(budget, 1500), false);
    assert.equal(allowCancel(budget, 1000 + 4000), true);
  });

  it("transcript dedupe drops empty and repeats", () => {
    const d = createTranscriptDedupe();
    assert.equal(shouldAcceptTranscript(d, "  "), false);
    assert.equal(shouldAcceptTranscript(d, "hello", 1000), true);
    assert.equal(shouldAcceptTranscript(d, "hello", 1500), false);
    assert.equal(shouldAcceptTranscript(d, "hello", 4000), true);
  });

  it("reconnect backoff grows and caps attempts constant", () => {
    assert.equal(MAX_RECONNECT_ATTEMPTS, 3);
    assert.ok(nextReconnectDelayMs(1) < nextReconnectDelayMs(2));
    assert.ok(nextReconnectDelayMs(2) < nextReconnectDelayMs(3));
  });
});
