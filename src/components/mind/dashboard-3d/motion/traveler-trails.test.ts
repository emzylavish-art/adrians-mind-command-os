import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMotionClock } from "./motion-clock.ts";
import { createTravelerEaseSample, createTravelerEaseState, pauseTraveler } from "./traveler-ease.ts";
import { isTravelerWrap, stepTravelerTrails, type TravelerTrail } from "./traveler-trails.ts";

const path = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
];
const FRAME = 1 / 60;
function mk(seed: number): TravelerTrail {
  return { ease: createTravelerEaseState(seed), sample: createTravelerEaseSample(), points: path, lastProgress: 0 };
}

describe("motion c21 — stepTravelerTrails", () => {
  it("counts exactly one genuine wrap per lap per trail", () => {
    const clock = createMotionClock();
    const trails = [mk(0.1), mk(0.6)];
    let wraps = 0;
    let t = 0;
    stepTravelerTrails(trails, t, FRAME, false, { clock, duration: 2 });
    for (let i = 0; i < 60 * 6; i++) wraps += stepTravelerTrails(trails, (t += FRAME), FRAME, false, { clock, duration: 2 });
    assert.equal(wraps, 6, "3 laps × 2 trails");
  });

  it("hold freezes all, release resumes without teleport or false wrap; caller pause is respected", () => {
    const clock = createMotionClock();
    const trails = [mk(0.95), mk(0.2)];
    pauseTraveler(trails[1]!.ease); // caller-owned pause
    let t = 1;
    stepTravelerTrails(trails, t, FRAME, false, { clock, duration: 4 });
    let wraps = 0;
    for (let i = 0; i < 300; i++) {
      clock.map((t += FRAME));
      wraps += stepTravelerTrails(trails, t, FRAME, false, { clock, duration: 4, hold: true });
    }
    const frozen = trails[0]!.sample.progress;
    wraps += stepTravelerTrails(trails, (t += FRAME), FRAME, false, { clock, duration: 4 });
    assert.ok(Math.abs(trails[0]!.sample.progress - frozen) <= FRAME / 4 + 1e-6, "no teleport on release");
    assert.equal(trails[1]!.ease.paused, true, "batch release must not resume a caller-owned pause");
    assert.equal(wraps, 0);
  });

  it("reduced-motion, null entries, NaN and huge inputs: zero wraps, finite output", () => {
    const clock = createMotionClock();
    const trails = [mk(0), null, undefined, { ...mk(0.5), points: null as never }, mk(Number.NaN)];
    for (let i = 0; i < 200; i++) {
      const w = stepTravelerTrails(trails, i % 7 === 0 ? Number.NaN : i * FRAME, Number.NaN, i % 2 === 0, {
        clock,
        maxTrails: Number.NaN,
      });
      assert.ok(Number.isFinite(w));
    }
    for (const tr of trails) if (tr) assert.ok(Number.isFinite(tr.sample.x) && Number.isFinite(tr.sample.opacity));
    assert.equal(stepTravelerTrails(null as never, 0, 0, false), 0);
    assert.equal(stepTravelerTrails(trails, 0, 0, false, { maxTrails: 0 }), 0);
  });

  it("isTravelerWrap rejects backwards jumps and garbage", () => {
    assert.equal(isTravelerWrap(0.98, 0.01), true);
    assert.equal(isTravelerWrap(0.6, 0.05), false, "big jump is a teleport, not a wrap");
    assert.equal(isTravelerWrap(0.3, 0.2), false);
    assert.equal(isTravelerWrap(Number.NaN, 0.1), false);
    assert.equal(isTravelerWrap(1.5, 0.1), false);
  });

  it("256 trails × 600 frames stays fast", () => {
    const clock = createMotionClock();
    const trails: TravelerTrail[] = [];
    for (let i = 0; i < 300; i++) trails.push(mk(i * 0.37));
    const t0 = performance.now();
    for (let f = 0; f < 600; f++) stepTravelerTrails(trails, f * FRAME, FRAME, false, { clock, hold: f % 3 === 0 });
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `took ${ms}ms`);
    assert.equal(trails[255]!.sample.done, false, "within cap is stepped");
    assert.equal(trails[299]!.sample.done, true, "beyond TRAVELER_TRAILS_MAX is never stepped");
  });
});
