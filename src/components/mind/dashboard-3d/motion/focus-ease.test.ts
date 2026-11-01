import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOCUS_PULSE_SCALE,
  applyFocusDrift,
  applyFocusPulse,
  createFocusEaseState,
  isFocusedStar,
  stepFocusDriftMul,
  stepFocusEase,
  stepFocusPulseMul,
} from "./focus-ease.ts";

describe("focus-ease — matching + unknown focusId", () => {
  it("isFocusedStar requires equal non-empty ids", () => {
    assert.equal(isFocusedStar("bot:a", "bot:a"), true);
    assert.equal(isFocusedStar("bot:a", "bot:b"), false);
    assert.equal(isFocusedStar("bot:a", null), false);
    assert.equal(isFocusedStar("bot:a", undefined), false);
    assert.equal(isFocusedStar("bot:a", ""), false);
    assert.equal(isFocusedStar("", "bot:a"), false);
    assert.equal(isFocusedStar(null, null), false);
    assert.equal(isFocusedStar(undefined, "x"), false);
  });

  it("unknown focusId leaves multipliers at rest targets", () => {
    const s = createFocusEaseState();
    stepFocusEase(s, "bot:a", "no-such-star", 1 / 60, false);
    // after one frame toward unfocused targets (already at 1/1) — stays ~1/1
    assert.ok(Math.abs(s.pulseMul - 1) < 1e-9);
    assert.ok(Math.abs(s.driftMul - 1) < 1e-9);
  });
});

describe("focus-ease — pulse + drift math", () => {
  it("pulse eases toward 1.25× when focused and back to 1 when cleared", () => {
    let mul = 1;
    for (let i = 0; i < 120; i++) mul = stepFocusPulseMul(mul, true, 1 / 60, false);
    assert.ok(mul > 1.2 && mul <= FOCUS_PULSE_SCALE + 1e-9, `got ${mul}`);
    assert.ok(Math.abs(mul - FOCUS_PULSE_SCALE) < 0.02);
    for (let i = 0; i < 120; i++) mul = stepFocusPulseMul(mul, false, 1 / 60, false);
    assert.ok(Math.abs(mul - 1) < 0.02, `return got ${mul}`);
  });

  it("drift damps to 0 near the focused star", () => {
    let mul = 1;
    for (let i = 0; i < 120; i++) mul = stepFocusDriftMul(mul, true, 1 / 60, false);
    assert.ok(mul < 0.05, `driftMul ${mul}`);
    for (let i = 0; i < 120; i++) mul = stepFocusDriftMul(mul, false, 1 / 60, false);
    assert.ok(mul > 0.95, `restored ${mul}`);
  });

  it("applyFocusPulse scales sample; applyFocusDrift pins at mul=0", () => {
    const pulse = { scale: 1.05, glow: 2.1, emissive: 0.7 };
    applyFocusPulse(pulse, FOCUS_PULSE_SCALE);
    assert.ok(Math.abs(pulse.scale - 1.05 * FOCUS_PULSE_SCALE) < 1e-9);
    const out = { x: 11, y: 2, z: -3 };
    const base = { x: 10, y: 0, z: 0 };
    applyFocusDrift(out, base, 0);
    assert.equal(out.x, 10);
    assert.equal(out.y, 0);
    assert.equal(out.z, 0);
    out.x = 11;
    out.y = 2;
    out.z = -3;
    applyFocusDrift(out, base, 1);
    assert.equal(out.x, 11);
    assert.equal(out.y, 2);
    assert.equal(out.z, -3);
  });
});

describe("focus-ease — mid-ease focus change + reduced motion", () => {
  it("focus change mid-ease retargets without snapping (motion on)", () => {
    const s = createFocusEaseState();
    // start easing toward bot:a
    for (let i = 0; i < 10; i++) stepFocusEase(s, "bot:a", "bot:a", 1 / 60, false);
    const midPulse = s.pulseMul;
    const midDrift = s.driftMul;
    assert.ok(midPulse > 1 && midPulse < FOCUS_PULSE_SCALE);
    assert.ok(midDrift < 1 && midDrift > 0);
    // focus jumps to bot:b — bot:a must ease back toward rest, not jump
    stepFocusEase(s, "bot:a", "bot:b", 1 / 60, false);
    assert.ok(s.pulseMul < midPulse); // one damp step toward 1
    assert.ok(s.driftMul > midDrift); // one damp step toward 1
    assert.ok(Math.abs(s.pulseMul - midPulse) < 0.1); // not a snap to 1
  });

  it("reduced-motion snaps pulse/drift instantly", () => {
    assert.equal(stepFocusPulseMul(1, true, 1 / 60, true), FOCUS_PULSE_SCALE);
    assert.equal(stepFocusDriftMul(1, true, 1 / 60, true), 0);
    assert.equal(stepFocusPulseMul(FOCUS_PULSE_SCALE, false, 1 / 60, true), 1);
    assert.equal(stepFocusDriftMul(0, false, 1 / 60, true), 1);
    const s = createFocusEaseState();
    stepFocusEase(s, "bot:a", "bot:a", 0, true);
    assert.equal(s.pulseMul, FOCUS_PULSE_SCALE);
    assert.equal(s.driftMul, 0);
  });

  it("NaN current/dt stay finite via damp guards", () => {
    const p = stepFocusPulseMul(Number.NaN, true, Number.NaN, false);
    const d = stepFocusDriftMul(Number.POSITIVE_INFINITY, true, -1, false);
    assert.ok(Number.isFinite(p));
    assert.ok(Number.isFinite(d));
  });
});
