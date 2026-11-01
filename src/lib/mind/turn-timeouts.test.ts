import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_RUN_TIMEOUT_MS,
  AGENT_TIMEOUT_REPLY,
  CHAT_TIMEOUT_REPLY,
  CHAT_TURN_TIMEOUT_MS,
  boundAbortSignal,
  isTimeoutAbort,
} from "./turn-timeouts.ts";

describe("turn timeouts", () => {
  it("exposes bounded chat and agent budgets", () => {
    assert.equal(CHAT_TURN_TIMEOUT_MS, 30_000);
    assert.equal(AGENT_RUN_TIMEOUT_MS, 45_000);
    assert.match(CHAT_TIMEOUT_REPLY, /Timed out/);
    assert.match(AGENT_TIMEOUT_REPLY, /Timed out/);
  });

  it("detects TimeoutError aborts", () => {
    const signal = AbortSignal.timeout(1);
    // wait briefly
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(signal.aborted, true);
        assert.equal(isTimeoutAbort(signal, signal.reason), true);
        assert.equal(isTimeoutAbort(signal, new DOMException("The operation timed out", "TimeoutError")), true);
        assert.equal(isTimeoutAbort(undefined, new Error("nope")), false);
        resolve();
      }, 20);
    });
  });

  it("boundAbortSignal aborts when the timer fires", async () => {
    const parent = new AbortController();
    const bound = boundAbortSignal(parent.signal, 30);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bound.signal.aborted, true);
    assert.equal(isTimeoutAbort(bound.signal, bound.signal.reason), true);
    bound.cleanup();
  });
});
