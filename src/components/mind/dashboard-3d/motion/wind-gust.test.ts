import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
  pauseTraveler,
  resumeTraveler,
  sampleTravelerPolyline,
  stepTravelerEase,
} from "./traveler-ease.ts";
import {
  GUST_MAX_SPEED,
  createWindGustSample,
  createWindGustState,
  impulseWindGust,
  stepWindGust,
} from "./wind-gust.ts";
import { createMotionClock } from "./motion-clock.ts";
import { createDustField } from "../particles/dust-field.ts";

describe("hacker c13 — traveler degenerate polylines + pause abuse", () => {
  it("0/1 point, duplicate consecutive, NaN coords stay finite", () => {
    const out = { x: 1, y: 1, z: 1 };
    sampleTravelerPolyline(out, [], 0.5);
    assert.deepEqual(out, { x: 0, y: 0, z: 0 });
    sampleTravelerPolyline(out, [{ x: 2, y: 3, z: 4 }], 0.9);
    assert.equal(out.x, 2);
    sampleTravelerPolyline(
      out,
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      0.7,
    );
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
    sampleTravelerPolyline(
      out,
      [
        { x: Number.NaN, y: 1, z: 0 },
        { x: 2, y: Number.POSITIVE_INFINITY, z: Number.NaN },
      ],
      0.5,
    );
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
  });

  it("10k-point polyline samples stay fast and finite", () => {
    const pts = Array.from({ length: 10_000 }, (_, i) => ({ x: i * 0.01, y: 0, z: 0 }));
    const out = { x: 0, y: 0, z: 0 };
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) sampleTravelerPolyline(out, pts, i / 2000);
    const ms = performance.now() - t0;
    assert.ok(Number.isFinite(out.x));
    assert.ok(ms < 100, `10k×2000 samples took ${ms}ms`);
  });

  it("pause/resume repeatedly and resume-without-pause are safe", () => {
    const st = createTravelerEaseState(0);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ];
    resumeTraveler(st); // without pause
    stepTravelerEase(st, out, path, 1, 1 / 60, false, { clock });
    for (let i = 0; i < 50; i++) {
      pauseTraveler(st);
      pauseTraveler(st);
      stepTravelerEase(st, out, path, 2 + i / 60, 1 / 60, false, { clock });
      resumeTraveler(st);
      resumeTraveler(st);
    }
    assert.ok(Number.isFinite(out.x));
    assert.ok(st.progress >= 0 && st.progress < 1);
  });
});

describe("hacker c13 — gust event-burst flood", () => {
  it("1000 impulses in one frame stay within GUST_MAX_SPEED", () => {
    const st = createWindGustState();
    const out = createWindGustSample();
    for (let i = 0; i < 1000; i++) {
      impulseWindGust(st, 1, 0, 0, false, 1);
    }
    stepWindGust(st, out, 0, false);
    assert.ok(out.speed <= GUST_MAX_SPEED + 1e-9, `speed=${out.speed}`);
    assert.ok(Math.abs(out.x) <= GUST_MAX_SPEED + 1e-9);
    // reduced-motion rejects further impulses and clears
    impulseWindGust(st, 0, 1, 0, true, 1);
    stepWindGust(st, out, 1 / 60, true);
    assert.equal(out.speed, 0);
  });
});

describe("wind-gust + dust hook", () => {
  it("dust impulseGust applies capped offset and decays", () => {
    const scene = new THREE.Scene();
    const clock = createMotionClock();
    const dust = createDustField(scene, { count: 32, clock, lod: false });
    assert.equal(typeof dust.impulseGust, "function");
    for (let i = 0; i < 1000; i++) dust.impulseGust(1, 0, 0, 1);
    assert.ok(dust.gust.speed <= GUST_MAX_SPEED + 1e-6);
    dust.update(1, false);
    assert.ok(dust.gust.speed <= GUST_MAX_SPEED + 1e-6);
    // reduced-motion clears
    dust.update(1.1, true);
    assert.equal(dust.gust.speed, 0);
    dust.dispose();
    dust.impulseGust(1, 0, 0); // no throw after dispose
  });

  it("NaN direction / strength are no-ops / capped", () => {
    const st = createWindGustState();
    impulseWindGust(st, Number.NaN, 0, 0, false, 1);
    assert.equal(st.vx, 0);
    impulseWindGust(st, 0, 0, 0, false, 1);
    assert.equal(st.vx, 0);
    impulseWindGust(st, 1, 0, 0, false, Number.POSITIVE_INFINITY);
    // strength clamped 0..1 so one impulse
    assert.ok(Math.hypot(st.vx, st.vy, st.vz) <= GUST_MAX_SPEED + 1e-9);
  });
});
