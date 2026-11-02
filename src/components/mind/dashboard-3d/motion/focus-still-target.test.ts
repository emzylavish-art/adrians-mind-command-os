/**
 * Motion c25 — stepFocusStillTarget: focused star eases to 1.25× pulse and
 * orbit amps × driftMul → 0 (still at base). Reduced-motion snaps.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFocusEaseState,
  FOCUS_PULSE_SCALE,
  stepFocusStillTarget,
} from "./focus-ease.ts";
import { createMotionClock } from "./motion-clock.ts";
import { stepStarFieldBatch } from "./star-batch.ts";

describe("c25 — stepFocusStillTarget", () => {
  it("unfocused keeps pulse near 1 and drifts off base", () => {
    const st = createFocusEaseState();
    const pulse = { scale: 1, glow: 2, emissive: 0.5 };
    const pos = { x: 0, y: 0, z: 0 };
    const base = { x: 10, y: 0, z: 0 };
    const clock = createMotionClock();
    for (let i = 0; i < 90; i++) {
      pulse.scale = 1;
      pulse.glow = 2;
      stepFocusStillTarget(st, pulse, pos, base, "a", null, 5 + i / 60, 0.3, 1 / 60, false, {
        radialAmp: 0.35,
        bobAmp: 0.2,
        clock,
      });
    }
    assert.ok(Math.abs(st.pulseMul - 1) < 0.05);
    assert.ok(st.driftMul > 0.9);
    const dist = Math.hypot(pos.x - base.x, pos.y - base.y, pos.z - base.z);
    assert.ok(dist > 0.01, "should orbit when unfocused");
  });

  it("focused eases pulse to 1.25× and pins position at base", () => {
    const st = createFocusEaseState();
    const pulse = { scale: 1, glow: 2, emissive: 0.5 };
    const pos = { x: 0, y: 0, z: 0 };
    const base = { x: 4, y: 1, z: -2 };
    const clock = createMotionClock();
    for (let i = 0; i < 180; i++) {
      pulse.scale = 1;
      pulse.glow = 2;
      stepFocusStillTarget(st, pulse, pos, base, "bot", "bot", 2 + i / 60, 1.1, 1 / 60, false, {
        radialAmp: 0.5,
        bobAmp: 0.4,
        clock,
      });
    }
    assert.ok(Math.abs(st.pulseMul - FOCUS_PULSE_SCALE) < 0.05);
    assert.ok(st.driftMul < 0.05);
    assert.ok(Math.abs(pulse.scale - FOCUS_PULSE_SCALE) < 0.15);
    assert.deepEqual(
      { x: +pos.x.toFixed(6), y: +pos.y.toFixed(6), z: +pos.z.toFixed(6) },
      { x: +base.x.toFixed(6), y: +base.y.toFixed(6), z: +base.z.toFixed(6) },
    );
  });

  it("reduced-motion snaps still at base with pulse 1.25 when focused", () => {
    const st = createFocusEaseState();
    const pulse = { scale: 1, glow: 2, emissive: 0.5 };
    const pos = { x: 9, y: 9, z: 9 };
    const base = { x: 1, y: 2, z: 3 };
    stepFocusStillTarget(st, pulse, pos, base, "x", "x", 10, 0, 1 / 60, true, {});
    assert.equal(st.pulseMul, FOCUS_PULSE_SCALE);
    assert.equal(st.driftMul, 0);
    assert.deepEqual(pos, base);
  });

  it("star-batch stillTarget pins focused star; default path unchanged identity for unfocused", () => {
    const ids = ["a", "b"];
    const healths = ["healthy", "healthy"];
    const bases = [
      { x: 5, y: 0, z: 0 },
      { x: -5, y: 0, z: 0 },
    ];
    const focus = [createFocusEaseState(), createFocusEaseState()];
    const pulse = [
      { scale: 1, glow: 2, emissive: 0.5 },
      { scale: 1, glow: 2, emissive: 0.5 },
    ];
    const pos = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ];
    const clock = createMotionClock();
    for (let i = 0; i < 120; i++) {
      stepStarFieldBatch(ids, healths, bases, focus, pulse, pos, "a", 3 + i / 60, 1 / 60, false, 2, {
        clock,
        stillTarget: true,
      });
    }
    assert.ok(focus[0]!.driftMul < 0.05);
    assert.deepEqual(
      { x: +pos[0]!.x.toFixed(5), y: +pos[0]!.y.toFixed(5), z: +pos[0]!.z.toFixed(5) },
      { x: +bases[0]!.x.toFixed(5), y: +bases[0]!.y.toFixed(5), z: +bases[0]!.z.toFixed(5) },
    );
    // Unfocused b should have drifted
    const d1 = Math.hypot(pos[1]!.x - bases[1]!.x, pos[1]!.y - bases[1]!.y, pos[1]!.z - bases[1]!.z);
    assert.ok(d1 > 0.01);
  });
});
