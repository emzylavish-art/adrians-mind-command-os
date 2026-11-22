import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TIER1_CONFIDENCE_GATE,
  TIER2_IDLE_UNLOAD_MS,
  classifyIntentHeuristic,
  createColdTier2State,
  formatDailyCommandLogLine,
  routeTier,
  shouldUnloadTier2,
  touchTier2,
  unloadTier2IfIdle,
} from "./three-tier-router.ts";

describe("three-tier-router", () => {
  it("keeps Tier 2 cold at startup", () => {
    const cold = createColdTier2State();
    assert.equal(cold.loaded, false);
    assert.equal(cold.loadedAtStartup, false);
    const d = routeTier({ text: "hello there friend how are you doing today" });
    assert.equal(d.preloadTier2AtStartup, false);
  });

  it("routes heartbeat and wake to Tier 1 doorman only", () => {
    const h = routeTier({ text: "heartbeat" });
    assert.equal(h.tier, 1);
    assert.equal(h.loadTier2, false);
    const w = routeTier({ text: "hey adrian" });
    assert.equal(w.tier, 1);
  });

  it("escalates low confidence to Tier 2 worker", () => {
    const d = routeTier({ text: "something ambiguous maybe", confidence: 0.5, intent: "general" });
    assert.equal(d.tier, 2);
    assert.equal(d.loadTier2, true);
    assert.ok(d.confidence < TIER1_CONFIDENCE_GATE);
  });

  it("sends architecture to Tier 3 cloud brain", () => {
    const d = routeTier({ text: "redesign system architecture for multi-step orchestration" });
    assert.equal(d.tier, 3);
    assert.equal(d.loadTier2, false);
  });

  it("escalates when Tier 2 is uncertain", () => {
    const d = routeTier({ text: "fix this", tier2Uncertain: true, intent: "log_triage", confidence: 0.9 });
    assert.equal(d.tier, 3);
  });

  it("unloads Tier 2 after hard 30s idle", () => {
    let s = createColdTier2State();
    s = touchTier2(s, 1_000);
    assert.equal(s.loaded, true);
    assert.equal(shouldUnloadTier2(s, 1_000 + TIER2_IDLE_UNLOAD_MS - 1), false);
    assert.equal(shouldUnloadTier2(s, 1_000 + TIER2_IDLE_UNLOAD_MS), true);
    s = unloadTier2IfIdle(s, 1_000 + TIER2_IDLE_UNLOAD_MS);
    assert.equal(s.loaded, false);
  });

  it("formats Daily Command Log lines", () => {
    const line = formatDailyCommandLogLine({
      id: "1",
      at: "2026-11-22T00:00:00.000Z",
      tier: 2,
      intent: "log_triage",
      latencyMs: 12,
      accepted: true,
      useful: true,
      promptChars: 10,
      responseChars: 20,
    });
    assert.match(line, /tier=2/);
    assert.match(line, /accepted=accepted/);
  });

  it("doorman heuristic never invents deep intent for empty text", () => {
    const c = classifyIntentHeuristic("");
    assert.equal(c.intent, "heartbeat");
  });
});
