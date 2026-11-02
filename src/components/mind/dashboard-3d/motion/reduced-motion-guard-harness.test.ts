/**
 * Motion c28 — lane-side RM guard harness over a simulated 5s wall clock.
 * HACKER (new vs c1–c27):
 *  - backwards / skewed nowMs must not stretch settle into a false long window
 *  - huge snapshots must hit a size budget (no perf cliff)
 *  - calls after disposeReducedMotionGuard must not throw or re-arm rebuild/heavy
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HASH_MOTION_SNAPSHOT_MAX_CHARS,
  createReducedMotionGuard,
  disposeReducedMotionGuard,
  hashMotionLaneSnapshot,
  runReducedMotionGuardHarness,
  shouldMountHeavy,
  shouldRebuildScene,
  snapRigProgress,
  stepReducedMotionSettle,
} from "./reduced-motion-guard.ts";

describe("hacker c28 — clock skew / backwards nowMs", () => {
  it("backwards wall clock does not leave settleUntilMs stranded in the far future", () => {
    const g = createReducedMotionGuard({ settleMs: 500 });
    // Rising edge at t=10_000 → settleUntil ≈ 10_500
    stepReducedMotionSettle(g, true, 10_000);
    assert.ok(g.settleUntilMs >= 10_000 && g.settleUntilMs <= 10_000 + 500);
    // Clock jumps backwards (tab resume / performance.now reset)
    stepReducedMotionSettle(g, true, 200);
    assert.ok(
      g.settleUntilMs <= 200 + 500 + 1,
      `settleUntil stranded at ${g.settleUntilMs} after backwards jump to 200`,
    );
  });

  it("NaN / negative / Infinity nowMs never poison settleUntilMs", () => {
    const g = createReducedMotionGuard({ settleMs: 400 });
    stepReducedMotionSettle(g, true, Number.NaN);
    assert.ok(Number.isFinite(g.settleUntilMs), `NaN poisoned settle ${g.settleUntilMs}`);
    stepReducedMotionSettle(g, false, 50);
    stepReducedMotionSettle(g, true, Number.POSITIVE_INFINITY);
    assert.ok(Number.isFinite(g.settleUntilMs), `Infinity poisoned settle ${g.settleUntilMs}`);
    stepReducedMotionSettle(g, false, 60);
    stepReducedMotionSettle(g, true, -5000);
    assert.ok(g.settleUntilMs >= 0, `negative now left settle ${g.settleUntilMs}`);
  });
});

describe("hacker c28 — huge snapshot budget", () => {
  it("hashMotionLaneSnapshot finishes under budget for a huge payload", () => {
    const huge = {
      bots: Array.from({ length: 50_000 }, (_, i) => ({
        id: `bot-${i}`,
        health: i % 3 === 0 ? "healthy" : "idle",
        base: { x: i, y: i % 7, z: -i },
      })),
    };
    const t0 = performance.now();
    const h = hashMotionLaneSnapshot(huge);
    const ms = performance.now() - t0;
    assert.equal(typeof h, "string");
    assert.ok(h.length >= 8);
    assert.ok(ms < 250, `huge hash took ${ms.toFixed(1)}ms — need size/time budget`);
    // Overflow sentinel must be stable for the same budget
    const h2 = hashMotionLaneSnapshot(huge);
    assert.equal(h, h2);
  });

  it("two different huge payloads that both overflow still do not throw", () => {
    const a = { n: 1, pad: "x".repeat(HASH_MOTION_SNAPSHOT_MAX_CHARS + 100) };
    const b = { n: 2, pad: "y".repeat(HASH_MOTION_SNAPSHOT_MAX_CHARS + 100) };
    assert.doesNotThrow(() => hashMotionLaneSnapshot(a));
    assert.doesNotThrow(() => hashMotionLaneSnapshot(b));
  });
});

describe("hacker c28 — dispose then call", () => {
  it("post-dispose rebuild/heavy/snap/settle never throw and never re-arm under RM", () => {
    const g = createReducedMotionGuard();
    const h = hashMotionLaneSnapshot({ v: 1 });
    assert.equal(shouldRebuildScene(g, h, true, 0), true);
    assert.equal(shouldMountHeavy(g, true), true);
    disposeReducedMotionGuard(g);
    assert.doesNotThrow(() => {
      assert.equal(shouldRebuildScene(g, hashMotionLaneSnapshot({ v: 2 }), true, 100), false);
      assert.equal(shouldMountHeavy(g, true), false);
      assert.equal(shouldMountHeavy(g, false), false); // disposed → deny even when motion on
      snapRigProgress({ t: 0.2 }, true);
      stepReducedMotionSettle(g, true, 200);
    });
    // dispose is idempotent
    assert.doesNotThrow(() => disposeReducedMotionGuard(g));
    assert.doesNotThrow(() => disposeReducedMotionGuard(null));
  });
});

describe("c28 — runReducedMotionGuardHarness (5s wall clock)", () => {
  it("stable payload under RM → exactly 1 rebuild, 1 heavy, rig snapped; zero churn after", () => {
    const report = runReducedMotionGuardHarness({
      durationMs: 5000,
      frameMs: 100,
      reducedMotion: true,
      // same payload every tick
      payloadAt: () => ({ bots: ["a", "b"], commits: ["c1"] }),
    });
    assert.equal(report.rebuildCount, 1, `stable must rebuild once, got ${report.rebuildCount}`);
    assert.equal(report.heavyCount, 1, `stable must heavy-once, got ${report.heavyCount}`);
    assert.equal(report.finalRigT, 1);
    assert.ok(report.frames >= 50);
  });

  it("one real data change mid-window → exactly 2 rebuilds (initial + change)", () => {
    const report = runReducedMotionGuardHarness({
      durationMs: 5000,
      frameMs: 100,
      reducedMotion: true,
      payloadAt: (t) =>
        t < 2500 ? { bots: ["a"], rev: 1 } : { bots: ["a", "b"], rev: 2 },
    });
    assert.equal(report.rebuildCount, 2, `one change → 2 rebuilds, got ${report.rebuildCount}`);
    assert.equal(report.heavyCount, 1);
  });

  it("three distinct changes → exactly 4 rebuilds (1 initial + 3)", () => {
    const report = runReducedMotionGuardHarness({
      durationMs: 5000,
      frameMs: 50,
      reducedMotion: true,
      payloadAt: (t) => ({ rev: Math.min(3, Math.floor(t / 1200)) }),
    });
    assert.equal(report.rebuildCount, 4, `got ${report.rebuildCount}`);
  });

  it("motion-on allows rebuild every frame (no RM gate)", () => {
    const report = runReducedMotionGuardHarness({
      durationMs: 500,
      frameMs: 100,
      reducedMotion: false,
      payloadAt: () => ({ x: 1 }),
    });
    assert.equal(report.rebuildCount, report.frames);
  });
});
