import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMET_LAUNCH_MAX_BURST,
  createCometLaunchSample,
  createCometLaunchState,
  scheduleCometLaunchBurst,
  stepCometLaunchEase,
} from "./comet-launch-ease.ts";
import {
  createFocusRingBreatheSample,
  createFocusRingBreatheState,
  setFocusRingActive,
  stepFocusRingBreathe,
  FOCUS_RING_BASE_OPACITY,
} from "./focus-ring-breathe.ts";
import { createMotionClock } from "./motion-clock.ts";
import {
  createWindGustSample,
  createWindGustState,
  impulseWindGust,
  stepWindGust,
} from "./wind-gust.ts";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
  stepTravelerEase,
} from "./traveler-ease.ts";

describe("hacker c15 — REA burst cliffs + shared-clock pause/resume", () => {
  it("burst of 10k commits + maxConcurrent=0 schedules nothing and stays fast", () => {
    const st = createCometLaunchState(24);
    const t0 = performance.now();
    const n0 = scheduleCometLaunchBurst(st, 10_000, false, { maxConcurrent: 0 });
    const nHuge = scheduleCometLaunchBurst(st, 10_000, false, { maxConcurrent: 6 });
    const ms = performance.now() - t0;
    assert.equal(n0, 0);
    assert.ok(nHuge <= COMET_LAUNCH_MAX_BURST);
    assert.ok(nHuge <= 6);
    assert.ok(ms < 50, `10k burst schedule took ${ms}ms`);
  });

  it("negative maxConcurrent / capacity behave safely", () => {
    const st = createCometLaunchState(-5);
    assert.equal(st.slots.length, 0);
    const st2 = createCometLaunchState(8);
    assert.equal(scheduleCometLaunchBurst(st2, 3, false, { maxConcurrent: -1 }), 0);
  });

  it("gust + traveler + comet-launch on one clock survive resume gap (no NaN pop)", () => {
    const clock = createMotionClock();
    const gust = createWindGustState();
    const gout = createWindGustSample();
    const traveler = createTravelerEaseState(0.1);
    const tout = createTravelerEaseSample();
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ];
    const launch = createCometLaunchState(8);
    const lout: ReturnType<typeof createCometLaunchSample>[] = [];
    scheduleCometLaunchBurst(launch, 4, false, { maxConcurrent: 4 });

    impulseWindGust(gust, 1, 0, 0, false, 1);
    stepWindGust(gust, gout, 1 / 60, false);
    stepTravelerEase(traveler, tout, path, 1, 1 / 60, false, { clock });
    stepCometLaunchEase(launch, lout, 1 / 60, false);

    // Simulate tab freeze/resume: huge wall jump through same clock
    const tResume = 1 + 3600;
    stepWindGust(gust, gout, 1 / 60, false);
    stepTravelerEase(traveler, tout, path, tResume, 1 / 60, false, { clock });
    stepCometLaunchEase(launch, lout, 1 / 60, false);
    clock.map(tResume);

    assert.ok(Number.isFinite(gout.speed));
    assert.ok(Number.isFinite(tout.x) && Number.isFinite(tout.progress));
    for (const s of lout) {
      if (!s) continue;
      assert.ok(Number.isFinite(s.opacity) && Number.isFinite(s.scale));
    }
  });
});

describe("focus-ring-breathe", () => {
  it("eases in on select and out on deselect; reduced-motion snaps static", () => {
    const st = createFocusRingBreatheState();
    const out = createFocusRingBreatheSample();
    const clock = createMotionClock();
    setFocusRingActive(st, true);
    for (let i = 0; i < 30; i++) stepFocusRingBreathe(st, out, i / 60, 1 / 60, false, { clock });
    assert.ok(st.amount > 0.9);
    assert.ok(out.opacity > 0);
    setFocusRingActive(st, false);
    for (let i = 0; i < 40; i++) stepFocusRingBreathe(st, out, 1 + i / 60, 1 / 60, false, { clock });
    assert.ok(st.amount < 0.1);
    assert.ok(out.opacity < 0.15);

    setFocusRingActive(st, true);
    stepFocusRingBreathe(st, out, 2, 1 / 60, true, { clock });
    assert.equal(st.amount, 1);
    assert.equal(out.opacity, FOCUS_RING_BASE_OPACITY);
    assert.equal(out.breathe, 0.5);
  });

  it("breathe phase-locks to MotionClock (same wall → same wave)", () => {
    const st = createFocusRingBreatheState();
    const a = createFocusRingBreatheSample();
    const b = createFocusRingBreatheSample();
    const clock = createMotionClock();
    setFocusRingActive(st, true);
    st.amount = 1;
    stepFocusRingBreathe(st, a, 5, 1 / 60, false, { clock });
    stepFocusRingBreathe(st, b, 5, 1 / 60, false, { clock });
    assert.equal(a.opacity, b.opacity);
    assert.equal(a.scale, b.scale);
  });

  it("NaN t/dt stay finite", () => {
    const st = createFocusRingBreatheState();
    const out = createFocusRingBreatheSample();
    setFocusRingActive(st, true);
    stepFocusRingBreathe(st, out, Number.NaN, Number.POSITIVE_INFINITY, false);
    assert.ok(Number.isFinite(out.opacity) && Number.isFinite(out.scale));
  });
});
