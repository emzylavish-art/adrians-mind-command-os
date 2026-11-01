import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialPollState, reducePoll } from "./status-poll.ts";

describe("status poll reducer (hacker pass)", () => {
  it("first failure is an honest error", () => {
    const s = reducePoll(initialPollState<number>(), { type: "failure", seq: 1, error: "HTTP 500" });
    assert.equal(s.status, "error");
  });

  it("failure after data keeps the scene mounted but marks stale (not silently green)", () => {
    let s = reducePoll(initialPollState<number>(), { type: "success", seq: 1, data: 42 });
    s = reducePoll(s, { type: "failure", seq: 2, error: "ECONNREFUSED", at: "2026-11-01T14:40:00+01:00" });
    assert.equal(s.status, "ready");
    assert.ok(s.status === "ready" && s.data === 42);
    assert.ok(s.status === "ready" && s.stale?.error === "ECONNREFUSED");
    // stale "since" sticks to first failure
    s = reducePoll(s, { type: "failure", seq: 3, error: "again", at: "2026-11-01T14:41:00+01:00" });
    assert.ok(s.status === "ready" && s.stale?.since === "2026-11-01T14:40:00+01:00");
    s = reducePoll(s, { type: "success", seq: 4, data: 43 });
    assert.ok(s.status === "ready" && s.stale === null && s.data === 43);
  });

  it("drops out-of-order responses", () => {
    let s = reducePoll(initialPollState<number>(), { type: "success", seq: 5, data: 5 });
    s = reducePoll(s, { type: "success", seq: 3, data: 3 });
    assert.ok(s.status === "ready" && s.data === 5);
    s = reducePoll(s, { type: "failure", seq: Number.NaN, error: "x" });
    assert.ok(s.status === "ready" && s.stale === null);
  });
});
