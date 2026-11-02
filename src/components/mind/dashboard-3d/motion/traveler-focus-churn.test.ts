/**
 * Hacker c21 — traveler-ease focus-churn probe.
 * Focus/panel churn drives pauseTraveler/resumeTraveler. Before c21 the first unpaused
 * step snapped progress to the absolute clock phase (teleport on every resume) and opacity
 * popped 0.55↔1 in a single frame. Reduced-motion also silently cleared `paused`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMotionClock } from "./motion-clock.ts";
import {
  createTravelerEaseSample,
  createTravelerEaseState,
  pauseTraveler,
  resumeTraveler,
  stepTravelerEase,
} from "./traveler-ease.ts";

const path = [
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 10, y: 10, z: 0 },
];
const DUR = 10;
const FRAME = 1 / 60;

function wrapDelta(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 0.5) d = 1 - d;
  return d;
}

describe("hacker c21 — traveler focus churn", () => {
  it("resume after a long pause continues from the frozen progress (no teleport)", () => {
    const st = createTravelerEaseState(0);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    let t = 0;
    for (let i = 0; i < 120; i++, t += FRAME) stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    pauseTraveler(st);
    for (let i = 0; i < 240; i++, t += FRAME) {
      clock.map(t); // other samplers on the shared clock keep it advancing during the pause
      stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    }
    const frozen = st.progress;
    const fx = out.x;
    const fy = out.y;
    resumeTraveler(st);
    stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    assert.ok(wrapDelta(st.progress, frozen) <= FRAME / DUR + 1e-6, `resume jumped ${wrapDelta(st.progress, frozen)}`);
    assert.ok(Math.hypot(out.x - fx, out.y - fy) < 0.05, "marker must not teleport on resume");
  });

  it("pause/resume every frame for 10s: per-frame progress and opacity deltas stay bounded", () => {
    const st = createTravelerEaseState(0.3);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    let t = 5;
    stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    let prevP = st.progress;
    let prevO = out.opacity;
    let maxDp = 0;
    let maxDo = 0;
    for (let i = 0; i < 600; i++) {
      t += FRAME;
      if (i % 2 === 0) pauseTraveler(st);
      else resumeTraveler(st);
      clock.map(t); // shared clock advanced by other samplers this frame
      stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
      assert.ok(Number.isFinite(out.x) && Number.isFinite(out.opacity));
      maxDp = Math.max(maxDp, wrapDelta(st.progress, prevP));
      maxDo = Math.max(maxDo, Math.abs(out.opacity - prevO));
      prevP = st.progress;
      prevO = out.opacity;
    }
    assert.ok(maxDp <= FRAME / DUR + 1e-6, `progress jumped ${maxDp} in one frame`);
    assert.ok(maxDo < 0.1, `opacity popped ${maxDo} in one frame`);
  });

  it("opacity eases into and out of the paused dim instead of popping", () => {
    const st = createTravelerEaseState(0);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    let t = 1;
    for (let i = 0; i < 60; i++, t += FRAME) stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    const full = out.opacity;
    pauseTraveler(st);
    stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    assert.ok(out.opacity > full * 0.8, "first paused frame must not pop to dim");
    for (let i = 0; i < 120; i++, t += FRAME) stepTravelerEase(st, out, path, t, FRAME, false, { clock, duration: DUR });
    assert.ok(Math.abs(out.opacity - full * 0.55) < 0.02, `settles at dim, got ${out.opacity}`);
  });

  it("reduced-motion keeps the paused flag and leaving it resumes from the static pose", () => {
    const st = createTravelerEaseState(0.25);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    pauseTraveler(st);
    stepTravelerEase(st, out, path, 50, FRAME, true, { clock, duration: DUR });
    assert.equal(st.paused, true, "reduced-motion must not silently resume a paused traveler");
    resumeTraveler(st);
    stepTravelerEase(st, out, path, 50 + FRAME, FRAME, true, { clock, duration: DUR });
    const pose = st.progress;
    stepTravelerEase(st, out, path, 50 + 2 * FRAME, FRAME, false, { clock, duration: DUR });
    assert.ok(wrapDelta(st.progress, pose) <= FRAME / DUR + 1e-6, "leaving reduced-motion must not snap");
  });

  it("NaN/huge times and garbage state fields during churn stay finite", () => {
    const st = createTravelerEaseState(1e12);
    const out = createTravelerEaseSample();
    const clock = createMotionClock();
    const ts = [0, Number.NaN, 1e15, -5, Number.POSITIVE_INFINITY, 3];
    for (let i = 0; i < 60; i++) {
      if (i % 3 === 0) pauseTraveler(st);
      if (i % 3 === 1) resumeTraveler(st);
      if (i === 30) (st as { progress: number }).progress = Number.NaN;
      stepTravelerEase(st, out, path, ts[i % ts.length]!, Number.NaN, false, { clock, duration: DUR });
      assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.opacity));
      assert.ok(st.progress >= 0 && st.progress < 1);
    }
  });
});
