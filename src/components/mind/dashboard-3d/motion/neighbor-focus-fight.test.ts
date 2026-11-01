/**
 * Hacker c19 — neighbor drift damp vs focus-ease tug-of-war.
 *
 * INTEGRATION (c18) documents: `stepFocusEase` (or star-batch) THEN
 * `stepNeighborDriftDamp`. focus-ease pulls every non-focused driftMul toward 1
 * each frame, neighbor damp pulls it toward the floor, so the documented wiring
 * settled at ~0.71 instead of NEIGHBOR_DRIFT_FLOOR (0.35) — a silent half-strength
 * damp whose equilibrium also shifts with frame rate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFocusEaseState, stepFocusEase } from "./focus-ease.ts";
import { NEIGHBOR_DRIFT_FLOOR, stepNeighborDriftDamp } from "./neighbor-drift-damp.ts";

function settle(fps: number, seconds = 10) {
  const s = createFocusEaseState();
  const nb = new Set(["b"]);
  const dt = 1 / fps;
  for (let i = 0; i < fps * seconds; i++) {
    stepFocusEase(s, "b", "a", dt, false);
    stepNeighborDriftDamp(s, "b", "a", nb, dt, false);
  }
  return s.driftMul;
}

describe("hacker c19 — neighbor damp composes with focus-ease", () => {
  it("documented order (focus-ease then neighbor) settles at the floor", () => {
    const v = settle(60);
    assert.ok(Math.abs(v - NEIGHBOR_DRIFT_FLOOR) < 1e-3, `settled ${v}`);
  });

  it("equilibrium is frame-rate independent (30 / 60 / 144 fps)", () => {
    for (const fps of [30, 60, 144]) {
      const v = settle(fps);
      assert.ok(Math.abs(v - NEIGHBOR_DRIFT_FLOOR) < 1e-3, `${fps}fps → ${v}`);
    }
  });

  it("focus hop a→b (b was neighbor, a becomes neighbor) stays continuous", () => {
    const sa = createFocusEaseState();
    const sb = createFocusEaseState();
    const nbOfA = new Set(["b"]);
    const nbOfB = new Set(["a"]);
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      stepFocusEase(sa, "a", "a", dt, false);
      stepNeighborDriftDamp(sa, "a", "a", nbOfA, dt, false);
      stepFocusEase(sb, "b", "a", dt, false);
      stepNeighborDriftDamp(sb, "b", "a", nbOfA, dt, false);
    }
    assert.ok(sa.driftMul < 0.01);
    let prevA = sa.driftMul;
    let prevB = sb.driftMul;
    let maxStep = 0;
    for (let i = 0; i < 300; i++) {
      stepFocusEase(sa, "a", "b", dt, false);
      stepNeighborDriftDamp(sa, "a", "b", nbOfB, dt, false);
      stepFocusEase(sb, "b", "b", dt, false);
      stepNeighborDriftDamp(sb, "b", "b", nbOfB, dt, false);
      maxStep = Math.max(maxStep, Math.abs(sa.driftMul - prevA), Math.abs(sb.driftMul - prevB));
      prevA = sa.driftMul;
      prevB = sb.driftMul;
    }
    assert.ok(maxStep < 0.2, `per-frame drift step ${maxStep}`);
    assert.ok(Math.abs(sa.driftMul - NEIGHBOR_DRIFT_FLOOR) < 1e-3, `a as neighbor ${sa.driftMul}`);
    assert.ok(sb.driftMul < 0.01, `b focused ${sb.driftMul}`);
  });

  it("focus cleared → neighbor recovers to 1 with focus-ease in the loop", () => {
    const s = createFocusEaseState();
    const nb = new Set(["b"]);
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      stepFocusEase(s, "b", "a", dt, false);
      stepNeighborDriftDamp(s, "b", "a", nb, dt, false);
    }
    for (let i = 0; i < 300; i++) {
      stepFocusEase(s, "b", null, dt, false);
      stepNeighborDriftDamp(s, "b", null, null, dt, false);
    }
    assert.ok(s.driftMul > 0.999, `recovered ${s.driftMul}`);
  });

  it("reduced-motion keeps neighbors at full drift even after a damped stretch", () => {
    const s = createFocusEaseState();
    const nb = new Set(["b"]);
    for (let i = 0; i < 120; i++) {
      stepFocusEase(s, "b", "a", 1 / 60, false);
      stepNeighborDriftDamp(s, "b", "a", nb, 1 / 60, false);
    }
    stepFocusEase(s, "b", "a", 1 / 60, true);
    stepNeighborDriftDamp(s, "b", "a", nb, 1 / 60, true);
    assert.equal(s.driftMul, 1);
  });
});
