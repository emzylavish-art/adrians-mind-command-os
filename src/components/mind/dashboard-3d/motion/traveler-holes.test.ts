/**
 * Hacker c24: a null / hole / non-object polyline vertex threw inside the rAF tick
 * (`Cannot read properties of null (reading 'x')`), aborting the rest of every frame.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
  sampleTravelerPolyline,
  stepTravelerEase,
} from "./traveler-ease.ts";
import { stepTravelerTrails } from "./traveler-trails.ts";
import { createMotionClock } from "./motion-clock.ts";

const P = (x: number, y = 0, z = 0) => ({ x, y, z });
const finite = (o: { x: number; y: number; z: number }) =>
  Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z);

describe("hacker c24 — traveler polyline holes", () => {
  it("null / undefined / sparse / primitive vertices never throw", () => {
    const cases: unknown[] = [
      [null],
      [undefined],
      [P(0), null, P(2)],
      [P(0), undefined, P(2)],
      new Array(3),
      [null, null],
      [7, "x", true],
      [P(1), 5],
    ];
    for (const pts of cases) {
      for (const u of [0, 0.25, 0.5, 0.75, 0.999, Number.NaN, -3.2]) {
        const out = { x: 9, y: 9, z: 9 };
        assert.doesNotThrow(() => sampleTravelerPolyline(out, pts as never, u), JSON.stringify(pts));
        assert.ok(finite(out));
      }
    }
  });

  it("non-array points (array-likes, numbers, strings) → origin, no throw", () => {
    for (const pts of [7, "abc", { length: 2 }, { length: 2, 0: P(1), 1: P(2) }, true]) {
      const out = { x: 9, y: 9, z: 9 };
      assert.doesNotThrow(() => sampleTravelerPolyline(out, pts as never, 0.5));
      assert.deepEqual(out, { x: 0, y: 0, z: 0 });
    }
  });

  it("a missing endpoint falls back to the other; both missing holds position", () => {
    const out = { x: 0, y: 0, z: 0 };
    sampleTravelerPolyline(out, [P(0), null, P(4)] as never, 0.25); // seg 0: A=P(0), B=null → A
    assert.deepEqual(out, P(0));
    sampleTravelerPolyline(out, [P(0), null, P(4)] as never, 0.75); // seg 1: A=null, B=P(4) → B
    assert.deepEqual(out, P(4));
    const held = { x: 3, y: 2, z: 1 };
    sampleTravelerPolyline(held, [null, null, P(1)] as never, 0.1);
    assert.deepEqual(held, { x: 3, y: 2, z: 1 }, "no teleport to origin");
    // Valid polylines unchanged.
    sampleTravelerPolyline(out, [P(0), P(10)], 0.5);
    assert.deepEqual(out, P(5));
  });

  it("stepTravelerEase / stepTravelerTrails survive holes for many frames", () => {
    const clock = createMotionClock();
    const st = createTravelerEaseState(0.3);
    const out = createTravelerEaseSample();
    const pts = [P(0), null, P(2), undefined, P(4)] as never;
    for (let f = 0; f < 600; f++) {
      for (const rm of [false, true]) {
        assert.doesNotThrow(() => stepTravelerEase(st, out, pts, 5 + f / 60, 1 / 60, rm, { clock }));
        assert.ok(finite(out) && Number.isFinite(out.opacity));
      }
    }
    const trails = [
      { points: pts, ease: createTravelerEaseState(0.1), sample: createTravelerEaseSample(), lastProgress: 0 },
      { points: 7 as never, ease: createTravelerEaseState(0.2), sample: createTravelerEaseSample(), lastProgress: 0 },
      { points: null as never, ease: createTravelerEaseState(0.2), sample: createTravelerEaseSample(), lastProgress: 0 },
    ];
    for (let f = 0; f < 120; f++) {
      assert.doesNotThrow(() => stepTravelerTrails(trails, 5 + f / 60, 1 / 60, false, { clock }));
    }
    for (const tr of trails) assert.ok(finite(tr.sample));
  });
});
