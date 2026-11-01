import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  GUST_MAX_SPEED,
  createWindGustSample,
  createWindGustState,
  impulseWindGust,
  stepWindGust,
} from "./wind-gust.ts";
import { createDustField } from "../particles/dust-field.ts";
import { createMotionClock } from "./motion-clock.ts";
import {
  COMET_LAUNCH_MAX_CONCURRENT,
  clearCometLaunch,
  createCometLaunchSample,
  createCometLaunchState,
  scheduleCometLaunchBurst,
  stepCometLaunchEase,
} from "./comet-launch-ease.ts";

describe("hacker c14 — wind-gust dirs / mid-RM / dispose / float snap", () => {
  it("zero / NaN / huge direction vectors do not inject non-finite velocity", () => {
    const st = createWindGustState();
    impulseWindGust(st, 0, 0, 0, false, 1);
    assert.equal(st.vx, 0);
    impulseWindGust(st, Number.NaN, 1, 0, false, 1);
    assert.equal(st.vx, 0);
    impulseWindGust(st, 1e308, 1e308, 1e308, false, 1);
    assert.ok(Number.isFinite(st.vx) && Number.isFinite(st.vy) && Number.isFinite(st.vz));
    assert.ok(Math.hypot(st.vx, st.vy, st.vz) <= GUST_MAX_SPEED + 1e-9);
  });

  it("reduced-motion mid-gust clears residual; resume does not revive force", () => {
    const st = createWindGustState();
    const out = createWindGustSample();
    impulseWindGust(st, 1, 0, 0, false, 1);
    stepWindGust(st, out, 1 / 60, false);
    assert.ok(out.speed > 0);
    stepWindGust(st, out, 1 / 60, true);
    assert.equal(out.speed, 0);
    assert.equal(st.vx, 0);
    stepWindGust(st, out, 1 / 60, false);
    assert.equal(out.speed, 0, "must not revive residual after RM clear");
  });

  it("long-session decay snaps sub-epsilon residual to exact rest", () => {
    const st = createWindGustState();
    const out = createWindGustSample();
    st.vx = 1e-5;
    st.vy = -1e-5;
    st.vz = 1e-5;
    stepWindGust(st, out, 1 / 60, false);
    assert.equal(out.speed, 0);
    assert.equal(st.vx, 0);
  });

  it("dust impulseGust after dispose is no-op and clears residual", () => {
    const scene = new THREE.Scene();
    const dust = createDustField(scene, { count: 16, clock: createMotionClock(), lod: false });
    dust.impulseGust(1, 0, 0, 1);
    assert.ok(dust.gust.speed > 0);
    dust.dispose();
    assert.equal(dust.gust.speed, 0);
    dust.impulseGust(0, 1, 0, 1);
    assert.equal(dust.gust.speed, 0);
    dust.update(1, false); // no throw
  });
});

describe("comet-launch-ease", () => {
  it("staggers burst and caps concurrent live launches", () => {
    const st = createCometLaunchState(12);
    const n = scheduleCometLaunchBurst(st, 20, false, { maxConcurrent: 4 });
    assert.equal(n, 4);
    assert.ok(st.slots.filter((s) => s.live).length <= 4);
    // delays strictly increasing among live
    const delays = st.slots.filter((s) => s.live).map((s) => s.delay);
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i]! > delays[i - 1]!);
  });

  it("reduced-motion snaps static marks; clear is interruptible", () => {
    const st = createCometLaunchState(8);
    const out: ReturnType<typeof createCometLaunchSample>[] = [];
    scheduleCometLaunchBurst(st, 3, true);
    stepCometLaunchEase(st, out, 1 / 60, true);
    assert.equal(out[0]!.opacity, 1);
    assert.equal(out[0]!.done, true);
    clearCometLaunch(st);
    stepCometLaunchEase(st, out, 1 / 60, false);
    assert.equal(out[0]!.opacity, 0);
  });

  it("ease-out launch advances after stagger; NaN dt safe", () => {
    const st = createCometLaunchState(4);
    const out: ReturnType<typeof createCometLaunchSample>[] = [];
    scheduleCometLaunchBurst(st, 2, false, { stagger: 0.05, duration: 0.2 });
    stepCometLaunchEase(st, out, Number.NaN, false);
    assert.ok(out[0]!.opacity === 0 || Number.isFinite(out[0]!.opacity));
    // drain first delay
    for (let i = 0; i < 10; i++) stepCometLaunchEase(st, out, 0.02, false);
    assert.ok(out[0]!.visible);
    assert.ok(out[0]!.scale >= 0.6 && out[0]!.scale <= 1);
  });
});
