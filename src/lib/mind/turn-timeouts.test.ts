import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_TIMEOUT_REPLY,
  CHAT_TIMEOUT_REPLY,
  DEFAULT_AGENT_RUN_TIMEOUT_MS,
  DEFAULT_CHAT_TURN_TIMEOUT_MS,
  agentRunTimeoutMs,
  boundAbortSignal,
  chatTurnTimeoutMs,
  isTimeoutAbort,
} from "./turn-timeouts.ts";

describe("turn timeouts", () => {
  it("defaults to 30s chat and 45s agent budgets", () => {
    assert.equal(chatTurnTimeoutMs({}), DEFAULT_CHAT_TURN_TIMEOUT_MS);
    assert.equal(agentRunTimeoutMs({}), DEFAULT_AGENT_RUN_TIMEOUT_MS);
    assert.equal(DEFAULT_CHAT_TURN_TIMEOUT_MS, 30_000);
    assert.equal(DEFAULT_AGENT_RUN_TIMEOUT_MS, 45_000);
    assert.match(CHAT_TIMEOUT_REPLY, /Timed out waiting for Grok/);
    assert.match(AGENT_TIMEOUT_REPLY, /Timed out waiting for the planner/);
  });

  it("honors MIND_CHAT_TIMEOUT_MS and MIND_AGENT_TIMEOUT_MS when ≥1000", () => {
    assert.equal(chatTurnTimeoutMs({ MIND_CHAT_TIMEOUT_MS: "12000" }), 12_000);
    assert.equal(agentRunTimeoutMs({ MIND_AGENT_TIMEOUT_MS: "60000" }), 60_000);
    assert.equal(chatTurnTimeoutMs({ MIND_CHAT_TIMEOUT_MS: "50" }), DEFAULT_CHAT_TURN_TIMEOUT_MS);
    assert.equal(agentRunTimeoutMs({ MIND_AGENT_TIMEOUT_MS: "nope" }), DEFAULT_AGENT_RUN_TIMEOUT_MS);
  });

  it("detects TimeoutError aborts", async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(signal.aborted, true);
    assert.equal(isTimeoutAbort(signal, signal.reason), true);
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
