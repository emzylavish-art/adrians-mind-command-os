/**
 * Motion c34 — traveler trail GPU upload throttle + enablePointBudget toggle harden.
 *
 * HACKER (new vs c1–c33): attack the opt-in toggle mid-flight —
 *   - enablePointBudget on↔off while trails are live
 *   - pointBudgetTotal changes while resampling
 *   - 0 / negative pointBudgetTotal must not escape to full polyline
 * Also: dirty-only resample/upload; duplicate clock.map(t) skips work.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import {
  TRAVELER_POINT_FAR,
  TRAVELER_POINT_MIN,
} from "./traveler-point-budget.ts";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
} from "./traveler-ease.ts";
import {
  consumeTravelerPointsDirty,
  stepTravelerTrails,
  type TravelerTrail,
} from "./traveler-trails.ts";

function fat(n = 48) {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0 }));
}

function makeTrail(points = fat()): TravelerTrail {
  return {
    ease: createTravelerEaseState(),
    sample: createTravelerEaseSample(),
    points,
    lastProgress: 0,
  };
}

describe("hacker c34 — enablePointBudget toggle mid-flight", () => {
  it("ON→OFF clears stale pointsBudget and samples the full polyline (no thin residual)", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    stepTravelerTrails([tr], 1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
    });
    assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
    assert.ok((tr.activePoints?.length ?? 0) >= TRAVELER_POINT_MIN);

    stepTravelerTrails([tr], 1.5, 1 / 60, false, {
      clock,
      enablePointBudget: false,
    });
    // Stale budget must not linger for Dashboard / debug readers.
    assert.equal(tr.pointsBudget, undefined, `stale pointsBudget=${tr.pointsBudget}`);
    // Progress along full 48-pt path at ~halfway → x near mid, not stuck on thin LOD.
    // After OFF, sampling must use original points length.
    assert.ok(
      tr.sample.x > TRAVELER_POINT_MIN,
      `still sampling thin residual? x=${tr.sample.x}`,
    );
  });

  it("OFF→ON reapplies far-cam thin budget without throw", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    stepTravelerTrails([tr], 1, 1 / 60, false, { clock, enablePointBudget: false });
    assert.equal(tr.pointsBudget, undefined);
    stepTravelerTrails([tr], 1.2, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 20,
    });
    assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
    assert.equal(consumeTravelerPointsDirty(tr), true, "first ON frame is dirty");
  });
});

describe("hacker c34 — budget change while resampling", () => {
  it("shrinking then growing pointBudgetTotal mid-flight converges; never throws", () => {
    const clock = createMotionClock();
    const trails = [makeTrail(fat(64)), makeTrail(fat(64)), makeTrail(fat(64))];
    assert.doesNotThrow(() => {
      stepTravelerTrails(trails, 1, 1 / 60, false, {
        clock,
        enablePointBudget: true,
        camDistance: 0, // near = full want, then total caps
        pointBudgetTotal: 30,
      });
      const mid = trails.map((t) => t.pointsBudget);
      stepTravelerTrails(trails, 1.1, 1 / 60, false, {
        clock,
        enablePointBudget: true,
        camDistance: 0,
        pointBudgetTotal: 6,
      });
      const small = trails.map((t) => t.pointsBudget!);
      assert.ok(small.reduce((a, b) => a + b, 0) <= 6 + 1e-9, `sum=${small}`);
      stepTravelerTrails(trails, 1.2, 1 / 60, false, {
        clock,
        enablePointBudget: true,
        camDistance: 0,
        pointBudgetTotal: 90,
      });
      const big = trails.map((t) => t.pointsBudget!);
      assert.ok(big.reduce((a, b) => a + b, 0) >= small.reduce((a, b) => a + b, 0));
      void mid;
    });
  });
});

describe("hacker c34 — zero / negative pointBudgetTotal", () => {
  it("total 0 does not escape to full polyline (sample parks, pointsBudget=0)", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    stepTravelerTrails([tr], 1, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
      pointBudgetTotal: 0,
    });
    assert.equal(tr.pointsBudget, 0);
    // Empty/parked — must NOT be mid-path on the 48-pt fat trail.
    assert.ok(
      Math.abs(tr.sample.x) < 1e-6 && Math.abs(tr.sample.y) < 1e-6,
      `escaped to full path x=${tr.sample.x}`,
    );
  });

  it("negative total sanitizes like 0 (no full-poly escape, no throw)", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    assert.doesNotThrow(() => {
      stepTravelerTrails([tr], 1, 1 / 60, false, {
        clock,
        enablePointBudget: true,
        camDistance: 5,
        pointBudgetTotal: -100,
      });
    });
    assert.equal(tr.pointsBudget, 0);
    assert.ok(Math.abs(tr.sample.x) < 1e-6, `neg escaped x=${tr.sample.x}`);
  });
});

describe("c34 — dirty-only resample / duplicate map(t) skip", () => {
  it("duplicate clock.map(t) skips resample; budget/cam change dirties again", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    const t = 2;
    stepTravelerTrails([tr], t, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
    });
    const r1 = tr.resampleCount ?? 0;
    assert.ok(r1 >= 1, "first step resamples");
    assert.equal(consumeTravelerPointsDirty(tr), true);

    // Same wall time → clock.map returns same mapped t → skip resample
    stepTravelerTrails([tr], t, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: TRAVELER_POINT_FAR + 10,
    });
    assert.equal(tr.resampleCount, r1, "duplicate map(t) must skip resample");
    assert.equal(consumeTravelerPointsDirty(tr), false, "no dirty after skip");

    // Cam jump that changes band → dirty + resample
    stepTravelerTrails([tr], t + 0.05, 1 / 60, false, {
      clock,
      enablePointBudget: true,
      camDistance: 1, // near → full
    });
    assert.ok((tr.resampleCount ?? 0) > r1, "cam band change must resample");
    assert.equal(consumeTravelerPointsDirty(tr), true);
  });
});
