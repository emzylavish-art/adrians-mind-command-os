import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { relayModelStream } from "./relay.ts";
import { pullMindEvents } from "./stream.ts";
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

function hangForeverFetch(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function readSseText(response: Response): Promise<string> {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    raw += decoder.decode(step.value);
  }
  return raw;
}

describe("timeout integration (hang-forever provider)", () => {
  it("chat relay ends with CHAT_TIMEOUT_REPLY at the 30s budget (fake timers)", async () => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    try {
      const budget = chatTurnTimeoutMs({});
      assert.equal(budget, DEFAULT_CHAT_TURN_TIMEOUT_MS);
      const incoming = new AbortController();
      const response = relayModelStream({
        apiKey: "test-key",
        model: "grok-4.5",
        messages: [{ role: "user", content: "hi" }],
        usedIds: [],
        requestSignal: incoming.signal,
        timeoutMs: budget,
        fetchImpl: hangForeverFetch,
      });
      const pending = readSseText(response);
      mock.timers.tick(budget);
      const raw = await pending;
      const error = pullMindEvents(raw).events.find((event) => event.event === "error");
      assert.equal(error?.event, "error");
      if (error?.event === "error") assert.equal(error.error, CHAT_TIMEOUT_REPLY);
      assert.equal(raw.includes("Grok did not answer in time"), false);
    } finally {
      mock.timers.reset();
    }
  });

  it("agent budget aborts a hang-forever wait at 45s with AGENT_TIMEOUT_REPLY semantics", async () => {
    mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    try {
      const budget = agentRunTimeoutMs({});
      assert.equal(budget, DEFAULT_AGENT_RUN_TIMEOUT_MS);
      const parent = new AbortController();
      const bound = boundAbortSignal(parent.signal, budget);
      let rejected: unknown = null;
      const hang = new Promise<never>((_resolve, reject) => {
        if (bound.signal.aborted) {
          reject(bound.signal.reason);
          return;
        }
        bound.signal.addEventListener(
          "abort",
          () => {
            rejected = bound.signal.reason;
            reject(bound.signal.reason);
          },
          { once: true },
        );
      });
      mock.timers.tick(budget);
      await assert.rejects(hang);
      assert.equal(isTimeoutAbort(bound.signal, rejected), true);
      // Same copy the agent HTTP handler returns on timeout
      assert.equal(AGENT_TIMEOUT_REPLY.includes("Timed out waiting for the planner"), true);
      bound.cleanup();
    } finally {
      mock.timers.reset();
    }
  });
});
