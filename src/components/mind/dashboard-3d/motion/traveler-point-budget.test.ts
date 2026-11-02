/**
 * Motion c33 — traveler trail point budget.
 * Cap/resample polyline vertices by cam distance + speed; focused traveler stays full-res.
 *
 * HACKER (new vs c1–c32):
 *  - glow clamp × focus/pulse at CAP boundary (regression pin with breathe-scale mul)
 *  - point-LOD hysteresis under camera teleport / threshold oscillation
 *  - global trail budget overflow with many long travelers
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFocusPulse } from "./focus-ease.ts";
import {
  GLOW_BASE,
  GLOW_SCALE_CAP,
  clampGlowScale,
  sampleStarPulse,
} from "./star-pulse.ts";
import { createMotionClock } from "./motion-clock.ts";
import {
  TRAVELER_POINT_BUDGET_TOTAL,
  TRAVELER_POINT_FAR,
  TRAVELER_POINT_HYST,
  TRAVELER_POINT_MIN,
  TRAVELER_POINT_NEAR,
  allocateTravelerPointBudgets,
  createTravelerPointLodState,
  resampleTravelerPolyline,
  stepTravelerPointLod,
} from "./traveler-point-budget.ts";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
  sampleTravelerPolyline,
} from "./traveler-ease.ts";
import { stepTravelerTrails, type TravelerTrail } from "./traveler-trails.ts";

function longPath(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: Math.sin(i * 0.2), z: i * 0.1 }));
}

describe("hacker c33 — glow cap at boundary with focus/pulse", () => {
  it("pulse at CAP then applyFocusPulse(>1) stays ≤ CAP (no bleed past painter ceiling)", () => {
    const clock = createMotionClock();
    const out = { scale: 1, glow: 0, emissive: 0 };
    // Drive blocked pulse to peak repeatedly
    for (let i = 0; i < 90; i++) sampleStarPulse(out, i / 60, 0, "blocked", false, clock);
    out.glow = GLOW_SCALE_CAP; // sit exactly on the boundary
    applyFocusPulse(out, 1.25);
    assert.ok(out.glow <= GLOW_SCALE_CAP + 1e-9, `bled to ${out.glow}`);
    out.glow = GLOW_SCALE_CAP;
    applyFocusPulse(out, 4);
    assert.equal(clampGlowScale(out.glow), GLOW_SCALE_CAP);
    assert.ok(out.glow <= GLOW_SCALE_CAP + 1e-9);
    // Base still below cap so multipliers have room
    assert.ok(GLOW_BASE < GLOW_SCALE_CAP);
  });
});

describe("hacker c33 — LOD hysteresis under camera teleport", () => {
  it("teleport far→near→far across threshold does not flicker within hyst band", () => {
    const full = 64;
    const st = createTravelerPointLodState(full);
    assert.equal(stepTravelerPointLod(st, TRAVELER_POINT_FAR + 5, full), TRAVELER_POINT_MIN);
    // Teleport into near
    assert.equal(stepTravelerPointLod(st, TRAVELER_POINT_NEAR - 1, full), full);
    // Teleport just past FAR then oscillate inside hyst — stay thin
    assert.equal(stepTravelerPointLod(st, TRAVELER_POINT_FAR + 1, full), TRAVELER_POINT_MIN);
    const edge = TRAVELER_POINT_FAR - TRAVELER_POINT_HYST / 2;
    for (let i = 0; i < 30; i++) {
      const d = i % 2 === 0 ? TRAVELER_POINT_FAR + 0.5 : edge;
      assert.equal(stepTravelerPointLod(st, d, full), TRAVELER_POINT_MIN, `flicker i=${i}`);
    }
  });

  it("NaN / 0 / Inf distance stays safe (near or far band, never throw)", () => {
    const st = createTravelerPointLodState(32);
    for (const d of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      assert.doesNotThrow(() => {
        const n = stepTravelerPointLod(st, d, 32);
        assert.ok(n >= TRAVELER_POINT_MIN && n <= 32);
      });
    }
  });
});

describe("hacker c33 — trail budget overflow", () => {
  it("many long travelers sum ≤ TRAVELER_POINT_BUDGET_TOTAL; focused keep full", () => {
    const trails = Array.from({ length: 80 }, (_, i) => ({
      pointCount: 128,
      focused: i === 3,
      speed: 1 + (i % 5) * 0.2,
    }));
    const budgets = allocateTravelerPointBudgets(trails, TRAVELER_POINT_FAR + 20);
    assert.equal(budgets.length, 80);
    assert.equal(budgets[3], 128, "focused traveler keeps full polyline");
    const sum = budgets.reduce((a, b) => a + b, 0);
    assert.ok(sum <= TRAVELER_POINT_BUDGET_TOTAL, `overflow sum=${sum}`);
    for (const b of budgets) assert.ok(b >= TRAVELER_POINT_MIN || b === 0);
  });

  it("resample preserves endpoints and progress sample stays finite", () => {
    const src = longPath(40);
    const out = Array.from({ length: 40 }, () => ({ x: 0, y: 0, z: 0 }));
    const n = resampleTravelerPolyline(out, src, 5);
    assert.equal(n, 5);
    assert.equal(out[0]!.x, src[0]!.x);
    assert.equal(out[4]!.x, src[39]!.x);
    const sample = createTravelerEaseSample();
    sampleTravelerPolyline(sample, out.slice(0, n), 0.5);
    assert.ok(Number.isFinite(sample.x) && Number.isFinite(sample.z));
  });
});

describe("c33 — stepTravelerTrails wires point budget", () => {
  it("far cam thins non-focus trails; focus trail keeps full point count for sampling", () => {
    const clock = createMotionClock();
    const fat = longPath(48);
    const trails: TravelerTrail[] = [
      { ease: createTravelerEaseState(0.1), sample: createTravelerEaseSample(), points: fat, lastProgress: 0 },
      { ease: createTravelerEaseState(0.5), sample: createTravelerEaseSample(), points: fat, lastProgress: 0, focused: true },
    ];
    stepTravelerTrails(trails, 1, 1 / 60, false, {
      clock,
      camDistance: TRAVELER_POINT_FAR + 10,
      enablePointBudget: true,
    });
    assert.equal(trails[0]!.pointsBudget, TRAVELER_POINT_MIN, `non-focus far budget ${trails[0]!.pointsBudget}`);
    assert.equal(trails[1]!.pointsBudget, fat.length, `focus keeps full ${trails[1]!.pointsBudget}`);
  });
});
