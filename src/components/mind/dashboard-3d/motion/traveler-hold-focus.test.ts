/**
 * Motion c36 — traveler hold × focus churn.
 *
 * Hold must freeze the sampled polyline: focus flips under hold must not
 * teleport the sample or count false wraps. Resume restores the budget band.
 *
 * HACKER (new vs c1–c35): hold+focus polyline swap mid-freeze; hold/focus spam
 * same window; NaN/Inf dt under hold×focus.
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
  pauseTraveler,
} from "./traveler-ease.ts";
import {
  stepTravelerTrails,
  type TravelerTrail,
} from "./traveler-trails.ts";

function fat(n = 48) {
  return Array.from({ length: n }, (_, i) => ({
    x: i * 2,
    y: Math.sin(i) * 3,
    z: i * 0.5,
  }));
}

function makeTrail(n = 48): TravelerTrail {
  return {
    ease: createTravelerEaseState(),
    sample: createTravelerEaseSample(),
    points: fat(n),
    lastProgress: 0,
  };
}

const FAR = {
  enablePointBudget: true as const,
  camDistance: TRAVELER_POINT_FAR + 10,
  duration: 2,
};

describe("hacker c36 — hold + focus must not teleport", () => {
  it("focus flip under hold keeps sample position (no polyline swap teleport)", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    for (let i = 0; i < 40; i++) {
      stepTravelerTrails([tr], i * 0.05, 1 / 60, false, { clock, ...FAR });
    }
    assert.equal(tr.pointsBudget, TRAVELER_POINT_MIN);
    const before = { x: tr.sample.x, y: tr.sample.y, z: tr.sample.z, p: tr.sample.progress };

    tr.focused = true;
    let wraps = stepTravelerTrails([tr], 3, 1 / 60, false, { clock, hold: true, ...FAR });
    assert.equal(wraps, 0);
    let dist = Math.hypot(tr.sample.x - before.x, tr.sample.y - before.y, tr.sample.z - before.z);
    assert.ok(dist < 1e-6, `hold+focus teleported dist=${dist} budget=${tr.pointsBudget}`);
    assert.equal(tr.sample.progress, before.p);

    // Flip off while still held
    tr.focused = false;
    wraps = stepTravelerTrails([tr], 3.1, 1 / 60, false, { clock, hold: true, ...FAR });
    assert.equal(wraps, 0);
    dist = Math.hypot(tr.sample.x - before.x, tr.sample.y - before.y, tr.sample.z - before.z);
    assert.ok(dist < 1e-6, `hold+unfocus teleported dist=${dist}`);
  });
});

describe("hacker c36 — hold/focus spam + NaN dt", () => {
  it("alternating hold + focus spam: zero wraps while held, samples always finite", () => {
    const clock = createMotionClock();
    const trails = Array.from({ length: 16 }, () => makeTrail(40));
    let wraps = 0;
    for (let f = 0; f < 48; f++) {
      for (let i = 0; i < trails.length; i++) trails[i]!.focused = (f + i) % 3 === 0;
      const hold = f % 2 === 1;
      const dt = f % 5 === 0 ? Number.NaN : 1 / 60;
      wraps += stepTravelerTrails(trails, 5 + f / 60, dt, false, {
        clock,
        hold,
        ...FAR,
        duration: 3,
      });
      for (const tr of trails) {
        assert.ok(Number.isFinite(tr.sample.x) && Number.isFinite(tr.sample.y) && Number.isFinite(tr.sample.z));
        assert.ok(Number.isFinite(tr.sample.progress));
      }
    }
    // wraps only possible on non-hold frames; must stay small / non-negative
    assert.ok(wraps >= 0 && wraps < 16 * 24, `wrap storm ${wraps}`);
  });

  it("NaN / Inf dt under hold×focus never throws; sample stays finite", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    tr.focused = true;
    assert.doesNotThrow(() => {
      stepTravelerTrails([tr], 1, Number.NaN, false, { clock, hold: true, ...FAR });
      stepTravelerTrails([tr], 1.1, Number.POSITIVE_INFINITY, false, { clock, hold: true, ...FAR });
      stepTravelerTrails([tr], Number.NaN, 1 / 60, false, { clock, hold: false, ...FAR });
    });
    assert.ok(Number.isFinite(tr.sample.x));
  });
});

describe("c36 — resume restores budget band; caller pause respected", () => {
  it("after hold+focus churn, resume applies focused full / unfocused thin; no false wrap", () => {
    const clock = createMotionClock();
    const a = makeTrail();
    const b = makeTrail();
    for (let i = 0; i < 30; i++) {
      stepTravelerTrails([a, b], i * 0.05, 1 / 60, false, { clock, ...FAR });
    }
    a.focused = true;
    b.focused = false;
    // churn under hold
    let wraps = 0;
    for (let i = 0; i < 10; i++) {
      a.focused = i % 2 === 0;
      b.focused = i % 2 === 1;
      wraps += stepTravelerTrails([a, b], 2 + i * 0.05, 1 / 60, false, { clock, hold: true, ...FAR });
    }
    assert.equal(wraps, 0);
    // final intent: a unfocused, b focused
    a.focused = false;
    b.focused = true;
    const bp = b.sample.progress;
    wraps = stepTravelerTrails([a, b], 4, 1 / 60, false, { clock, hold: false, ...FAR });
    assert.equal(wraps, 0, `false wrap on resume ${wraps}`);
    assert.equal(a.pointsBudget, TRAVELER_POINT_MIN);
    assert.equal(b.pointsBudget, 48);
    assert.ok(Number.isFinite(b.sample.x));
    // progress should advance only modestly one frame (not seam jump)
    assert.ok(Math.abs(b.sample.progress - bp) < 0.5 || b.sample.progress < bp);
  });

  it("caller-owned pause survives hold×focus and release", () => {
    const clock = createMotionClock();
    const tr = makeTrail();
    pauseTraveler(tr.ease);
    tr.focused = true;
    stepTravelerTrails([tr], 1, 1 / 60, false, { clock, hold: true, ...FAR });
    stepTravelerTrails([tr], 1.5, 1 / 60, false, { clock, hold: false, ...FAR });
    assert.equal(tr.ease.paused, true);
    assert.equal(tr.holdOwned, undefined);
  });
});
