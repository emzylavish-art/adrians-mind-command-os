/**
 * Hacker c19 — health crossfade flapping pops.
 *
 * Status polls can flap a bot's health (healthy→blocked→healthy, or through a
 * third state) faster than the ~0.35s crossfade settles. Before c19,
 * `setHealthPulseTarget` reset blend→0 while keeping/promoting one side, so the
 * displayed pulse jumped by up to ~50% of the amp difference on every flip.
 * Invariant: a retarget must not change the sample at the same instant.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMotionClock } from "./motion-clock.ts";
import {
  createHealthPulseCrossfadeState,
  sampleStarPulseCrossfaded,
  setHealthPulseTarget,
  stepHealthPulseCrossfade,
} from "./health-pulse-crossfade.ts";
import type { PulseSample } from "./star-pulse.ts";

const mk = (): PulseSample => ({ scale: 0, glow: 0, emissive: 0 });
const DT = 1 / 60;
const EPS = 1e-6;

function sampleAt(state: Parameters<typeof sampleStarPulseCrossfaded>[3], t: number, clock: ReturnType<typeof createMotionClock>) {
  const out = mk();
  sampleStarPulseCrossfaded(out, mk(), mk(), state, t, 0.37, false, { clock });
  return out;
}

function assertContinuous(a: PulseSample, b: PulseSample, label: string) {
  assert.ok(Math.abs(a.scale - b.scale) < EPS, `${label}: scale pop ${a.scale}→${b.scale}`);
  assert.ok(Math.abs(a.glow - b.glow) < EPS, `${label}: glow pop ${a.glow}→${b.glow}`);
  assert.ok(Math.abs(a.emissive - b.emissive) < EPS, `${label}: emissive pop ${a.emissive}→${b.emissive}`);
}

describe("hacker c19 — health crossfade flap continuity", () => {
  it("A→B then back to A mid-blend does not pop (blend > 0.5)", () => {
    const clock = createMotionClock();
    const s = createHealthPulseCrossfadeState("healthy");
    setHealthPulseTarget(s, "blocked", false);
    let t = 1;
    for (let i = 0; i < 6; i++) { stepHealthPulseCrossfade(s, DT, false); t += DT; }
    assert.ok(s.blend > 0.5 && s.blend < 0.999, `blend ${s.blend}`);
    const before = sampleAt(s, t, clock);
    setHealthPulseTarget(s, "healthy", false);
    assertContinuous(before, sampleAt(s, t, clock), "flap back");
  });

  it("A→B then back to A early (blend < 0.5) does not pop", () => {
    const clock = createMotionClock();
    const s = createHealthPulseCrossfadeState("healthy");
    setHealthPulseTarget(s, "blocked", false);
    stepHealthPulseCrossfade(s, DT, false);
    stepHealthPulseCrossfade(s, DT, false);
    assert.ok(s.blend > 0 && s.blend < 0.5);
    const before = sampleAt(s, 2, clock);
    setHealthPulseTarget(s, "healthy", false);
    assertContinuous(before, sampleAt(s, 2, clock), "early flap back");
  });

  it("A→B then C mid-blend (three-way) does not pop and still settles to C", () => {
    for (const steps of [2, 6, 15]) {
      const clock = createMotionClock();
      const s = createHealthPulseCrossfadeState("healthy");
      setHealthPulseTarget(s, "blocked", false);
      let t = 3;
      for (let i = 0; i < steps; i++) { stepHealthPulseCrossfade(s, DT, false); t += DT; }
      const before = sampleAt(s, t, clock);
      setHealthPulseTarget(s, "stalled", false);
      assertContinuous(before, sampleAt(s, t, clock), `three-way @${steps}`);
      for (let i = 0; i < 240; i++) stepHealthPulseCrossfade(s, DT, false);
      assert.equal(s.to, "stalled");
      assert.equal(s.blend, 1);
      const settled = sampleAt(s, 9, clock);
      const pure = mk();
      const ref = createHealthPulseCrossfadeState("stalled");
      sampleStarPulseCrossfaded(pure, mk(), mk(), ref, 9, 0.37, false, { clock });
      assertContinuous(pure, settled, `settled @${steps}`);
    }
  });

  it("rapid flap storm (1000 flips, 1 frame apart) stays finite and bounded per frame", () => {
    const clock = createMotionClock();
    const s = createHealthPulseCrossfadeState("healthy");
    const seq = ["blocked", "healthy", "stalled", "idle"] as const;
    let t = 0;
    let prev = sampleAt(s, t, clock);
    let maxJump = 0;
    for (let i = 0; i < 1000; i++) {
      setHealthPulseTarget(s, seq[i % seq.length], false);
      const now = sampleAt(s, t, clock);
      maxJump = Math.max(maxJump, Math.abs(now.scale - prev.scale), Math.abs(now.glow - prev.glow));
      stepHealthPulseCrossfade(s, DT, false);
      t += DT;
      prev = sampleAt(s, t, clock);
      assert.ok(Number.isFinite(prev.scale) && Number.isFinite(prev.glow) && Number.isFinite(prev.emissive));
    }
    assert.ok(maxJump < 0.02, `retarget-instant jump ${maxJump}`);
  });

  it("corrupt blend (NaN / >1 / <0) on retarget does not produce NaN or pop past bounds", () => {
    const clock = createMotionClock();
    for (const bad of [Number.NaN, 7, -3, Infinity]) {
      const s = createHealthPulseCrossfadeState("healthy");
      setHealthPulseTarget(s, "blocked", false);
      s.blend = bad;
      setHealthPulseTarget(s, "stalled", false);
      stepHealthPulseCrossfade(s, DT, false);
      const o = sampleAt(s, 1, clock);
      assert.ok(Number.isFinite(o.scale) && Number.isFinite(o.glow), `blend=${bad}`);
      assert.ok(s.blend >= 0 && s.blend <= 1);
    }
  });
});
