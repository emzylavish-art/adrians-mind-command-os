import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HONEST_FAILURE_MESSAGES,
  bindRetry,
  classifyHonestFailure,
  honestFailureAuditAction,
  honestFailureDescription,
} from "./failure-states.ts";

describe("honest failure states", () => {
  it("classifies the three defined states from existing copy", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.emergency_stop_active), "emergency_stop_active");
    assert.equal(classifyHonestFailure("Emergency stop is on. Inspection is blocked."), "emergency_stop_active");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.database_write_failed), "database_write_failed");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unavailable), "model_unavailable");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.model_unreachable), "model_unavailable");
    assert.equal(classifyHonestFailure("No Grok key is configured on the server. Another provider is not substituted."), "model_unavailable");
    assert.equal(classifyHonestFailure("Sign in is required."), null);
  });

  it("keeps one-line descriptions and audit action names stable", () => {
    assert.equal(honestFailureDescription("emergency_stop_active"), HONEST_FAILURE_MESSAGES.emergency_stop_active);
    assert.equal(honestFailureDescription("database_write_failed"), HONEST_FAILURE_MESSAGES.database_write_failed);
    assert.equal(honestFailureDescription("model_unavailable", "custom"), "custom");
    assert.equal(honestFailureAuditAction("model_unavailable"), "model_unavailable");
    assert.equal(honestFailureAuditAction("database_write_failed"), "database_write_failed");
    assert.equal(honestFailureAuditAction("emergency_stop_active"), "emergency_stop_active");
  });

  it("retries with identical parameters", () => {
    const calls: Array<[string, number]> = [];
    const retry = bindRetry((query: string, limit: number) => {
      calls.push([query, limit]);
    }, ["harbor dredge", 3] as [string, number]);
    retry();
    retry();
    assert.deepEqual(calls, [
      ["harbor dredge", 3],
      ["harbor dredge", 3],
    ]);
  });
});
