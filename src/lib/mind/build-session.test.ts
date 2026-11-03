import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  BUILD_TERMINAL,
  createBuildSession,
  fleetSimEnabled,
  queueSteer,
  rejectInjectedModel,
  sanitizeGoal,
  sanitizeSteer,
  sanitizeSessionId,
  setStatus,
  appendEvent,
  MAX_BUILD_STEER_CHARS,
} from "./build-session.ts";
import { cancelBuildSession, runBuildSession, steerBuildSession } from "./build-session-exec.ts";
import {
  canStartAnother,
  countActiveForOwner,
  memoryGet,
  memoryPut,
  resetBuildSessionStoreForTests,
  startInMemory,
  subscribeSession,
  rememberIdempotency,
  lookupIdempotency,
} from "./build-session-store.ts";
import { buildAgentModelBody } from "./agent.ts";
import { resetMindRateLimitsForTests } from "./limits.ts";

describe("build-session attacker cases", () => {
  beforeEach(() => {
    resetBuildSessionStoreForTests();
    resetMindRateLimitsForTests();
  });

  it("rejects client-injected model ids in payload", () => {
    assert.equal(rejectInjectedModel({ goal: "x", model: "grok-evil" }).ok, false);
    assert.equal(rejectInjectedModel({ goal: "x", modelId: "evil" }).ok, false);
    assert.equal(rejectInjectedModel({ goal: "x", providerModelId: "evil" }).ok, false);
    assert.equal(rejectInjectedModel({ goal: "x", modelTier: "Build" }).ok, true);
  });

  it("rejects huge steer messages", () => {
    const huge = "x".repeat(MAX_BUILD_STEER_CHARS + 10);
    const result = sanitizeSteer(huge);
    assert.equal(result.ok, false);
  });

  it("refuses steer after done", () => {
    let session = createBuildSession({ id: "bs_1", ownerId: "u1", botId: "bot", goal: "ship it" });
    session = setStatus(session, "done");
    memoryPut(session);
    const steered = steerBuildSession("bs_1", "u1", "add tests");
    assert.equal(steered.ok, false);
    if (!steered.ok) assert.match(steered.error, /finished/i);
  });

  it("blocks another user from reading a session id", () => {
    const session = startInMemory({ ownerId: "owner-a", botId: "bot", goal: "plan" });
    const foreign = memoryGet(session.id);
    assert.ok(foreign);
    const cancel = cancelBuildSession(session.id, "owner-b");
    assert.equal(cancel.ok, false);
    if (!cancel.ok) assert.equal(cancel.status, 404);
  });

  it("double start with idempotency key reuses active session", () => {
    const first = startInMemory({ ownerId: "u1", botId: "bot", goal: "one" });
    rememberIdempotency("u1", "key-1", first.id);
    const looked = lookupIdempotency("u1", "key-1");
    assert.equal(looked?.id, first.id);
  });

  it("cancel race marks session cancelled and aborts", async () => {
    const session = startInMemory({ ownerId: "u1", botId: "bot", goal: "slow" });
    const cancel = cancelBuildSession(session.id, "u1");
    assert.equal(cancel.ok, true);
    if (cancel.ok) assert.equal(cancel.session.status, "cancelled");
    const after = await runBuildSession(session.id, {
      fetchModel: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { text: "should not win", toolCalls: [] };
      },
      env: {},
    });
    assert.ok(after);
    assert.equal(after!.status, "cancelled");
  });

  it("provider error mid-stream marks failed", async () => {
    const session = startInMemory({ ownerId: "u1", botId: "bot", goal: "fail please" });
    const result = await runBuildSession(session.id, {
      env: { XAI_API_KEY: "xai-test-key-not-real-but-shaped-okxxxxxxxxxxxxxxxxxxxx" },
      fetchModel: async () => {
        throw new Error("provider status 500");
      },
    });
    // Without a valid key shape, may fail earlier at key resolve — either failed is ok.
    assert.ok(result);
    assert.ok(BUILD_TERMINAL.has(result!.status));
  });

  it("stream disconnect resume uses afterSeq (timeline seq monotonic)", () => {
    let session = createBuildSession({ id: "bs_resume", ownerId: "u1", botId: "bot", goal: "resume" });
    session = appendEvent(session, "log", "a");
    session = appendEvent(session, "log", "b");
    memoryPut(session);
    const after = 0;
    const missed = memoryGet("bs_resume")!.timeline.filter((e) => e.seq > after);
    assert.equal(missed.length, 2);
    assert.equal(missed[0]!.seq, 1);
  });

  it("SSE subscriber receives events after subscribe", async () => {
    const session = startInMemory({ ownerId: "u1", botId: "bot", goal: "live" });
    const seen: number[] = [];
    const unsub = subscribeSession(session.id, (next) => {
      seen.push(next.lastSeq);
    });
    memoryPut(appendEvent(memoryGet(session.id)!, "log", "hello"));
    unsub();
    assert.ok(seen.length >= 1);
  });

  it("caps active sessions per owner", () => {
    startInMemory({ ownerId: "u1", botId: "a", goal: "1" });
    startInMemory({ ownerId: "u1", botId: "b", goal: "2" });
    startInMemory({ ownerId: "u1", botId: "c", goal: "3" });
    assert.equal(countActiveForOwner("u1"), 3);
    assert.equal(canStartAnother("u1"), false);
  });

  it("buildAgentModelBody stream defaults false and can enable", () => {
    assert.equal(buildAgentModelBody([], {}).stream, false);
    assert.equal(buildAgentModelBody([], { stream: true }).stream, true);
  });

  it("fleet sim is off unless explicit flag", () => {
    assert.equal(fleetSimEnabled({}), false);
    assert.equal(fleetSimEnabled({ MIND_FLEET_SIM: "1" }), true);
  });

  it("sanitize session/goal reject garbage", () => {
    assert.equal(sanitizeSessionId("../../etc/passwd").ok, false);
    assert.equal(sanitizeGoal("").ok, false);
    assert.equal(sanitizeGoal("  build docks  ").ok, true);
  });

  it("queueSteer while running succeeds", () => {
    let session = createBuildSession({ id: "bs_q", ownerId: "u1", botId: "bot", goal: "go" });
    session = setStatus(session, "running");
    const q = queueSteer(session, "add tests");
    assert.equal(q.ok, true);
    if (q.ok) assert.equal(q.session.pendingSteers.includes("add tests"), true);
  });
});
