import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pulsePhaseFromId, sampleStarPulse, type PulseSample } from "./star-pulse.ts";

describe("star-pulse", () => {
  it("idle and reducedMotion freeze to unit scale", () => {
    const out: PulseSample = { scale: 0, glow: 0, emissive: 0 };
    sampleStarPulse(out, 1.5, 0.2, "healthy", true);
    assert.equal(out.scale, 1);
    sampleStarPulse(out, 1.5, 0.2, "idle", false);
    assert.equal(out.scale, 1);
    assert.equal(out.emissive, 0.25);
  });

  it("healthy pulse varies over time without allocating", () => {
    const out: PulseSample = { scale: 1, glow: 2, emissive: 0.7 };
    const a = sampleStarPulse(out, 0.1, 0, "healthy", false);
    const scaleA = a.scale;
    sampleStarPulse(out, 0.9, 0, "healthy", false);
    assert.notEqual(out.scale, scaleA);
    assert.ok(out.scale > 0.85 && out.scale < 1.2);
  });

  it("blocked pulses faster/higher amp than stalled", () => {
    const a: PulseSample = { scale: 1, glow: 0, emissive: 0 };
    const b: PulseSample = { scale: 1, glow: 0, emissive: 0 };
    // pick a time near peak for both with phase 0 — compare amp envelopes via max over samples
    let maxBlocked = 0;
    let maxStalled = 0;
    for (let t = 0; t < 4; t += 0.05) {
      sampleStarPulse(a, t, 0, "blocked", false);
      sampleStarPulse(b, t, 0, "stalled", false);
      maxBlocked = Math.max(maxBlocked, a.scale);
      maxStalled = Math.max(maxStalled, b.scale);
    }
    assert.ok(maxBlocked > maxStalled);
  });

  it("pulsePhaseFromId is stable and in 0..2π", () => {
    const p = pulsePhaseFromId("dashboard");
    assert.equal(pulsePhaseFromId("dashboard"), p);
    assert.ok(p >= 0 && p <= Math.PI * 2);
  });
});
