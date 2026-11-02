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

describe("health-pulse-crossfade", () => {
  it("eases amp/speed on health flip; reduced-motion snaps", () => {
    const clock = createMotionClock();
    const state = createHealthPulseCrossfadeState("healthy");
    assert.equal(state.blend, 1);
    setHealthPulseTarget(state, "blocked", false);
    assert.equal(state.to, "blocked");
    assert.equal(state.blend, 0);
    stepHealthPulseCrossfade(state, 1 / 60, false);
    assert.ok(state.blend > 0 && state.blend < 1);

    const out: PulseSample = { scale: 0, glow: 0, emissive: 0 };
    const a: PulseSample = { scale: 0, glow: 0, emissive: 0 };
    const b: PulseSample = { scale: 0, glow: 0, emissive: 0 };
    sampleStarPulseCrossfaded(out, a, b, state, 1.2, 0.3, false, { clock });
    assert.ok(Number.isFinite(out.scale) && Number.isFinite(out.glow));

    // Snap under reduced motion
    setHealthPulseTarget(state, "idle", true);
    assert.equal(state.from, "idle");
    assert.equal(state.to, "idle");
    assert.equal(state.blend, 1);
  });

  it("mid-crossfade retarget stays continuous and finite", () => {
    const state = createHealthPulseCrossfadeState("healthy");
    setHealthPulseTarget(state, "stalled", false);
    for (let i = 0; i < 5; i++) stepHealthPulseCrossfade(state, 1 / 60, false);
    const mid = state.blend;
    setHealthPulseTarget(state, "blocked", false);
    assert.equal(state.to, "blocked");
    assert.equal(state.blend, 0);
    assert.ok(mid > 0); // was mid-blend before retarget
    for (let i = 0; i < 120; i++) stepHealthPulseCrossfade(state, 1 / 60, false);
    assert.equal(state.blend, 1);
    assert.equal(state.from, "blocked");
  });

  it("same health is no-op; NaN dt does not explode", () => {
    const state = createHealthPulseCrossfadeState("healthy");
    setHealthPulseTarget(state, "healthy", false);
    assert.equal(state.blend, 1);
    stepHealthPulseCrossfade(state, Number.NaN, false);
    assert.equal(state.blend, 1);
    stepHealthPulseCrossfade(state, Number.POSITIVE_INFINITY, false);
    assert.ok(state.blend <= 1 && Number.isFinite(state.blend));
  });
});
