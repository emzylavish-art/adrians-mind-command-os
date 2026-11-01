import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { feedPulseSpeedMul, feedSeverity } from "./feed-severity.ts";

describe("feed-severity (#19)", () => {
  it("alerts only on real blocked/main text for merge/lock/gap", () => {
    assert.equal(feedSeverity("merge_gate", "landed fine on dashboard-3d"), "calm");
    assert.equal(feedSeverity("merge_gate", "blocked on main — do not merge"), "alert");
    assert.equal(feedSeverity("lock", "status: claimed waiting"), "calm");
    assert.equal(feedSeverity("lock", "halted by conductor"), "alert");
    assert.equal(feedSeverity("commit", "blocked somehow"), "calm"); // wrong kind
  });
  it("pulse mul is higher for alert", () => {
    assert.ok(feedPulseSpeedMul("alert") > feedPulseSpeedMul("calm"));
  });
});
