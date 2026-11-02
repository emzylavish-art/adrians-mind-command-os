/**
 * Motion c32 — painter star glow desaturate.
 * Painter c26: additive glow GLOW_BASE=2 saturated watercolor stars.
 * Cap out.glow (→ n.glow.scale) at GLOW_SCALE_CAP ≈1.45; GLOW_BASE ≈1.25.
 * HACKER: NaN / Infinity / over-boost focus×pulse must still clamp; never throw.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFocusPulse } from "./focus-ease.ts";
import {
  GLOW_BASE,
  GLOW_SCALE_CAP,
  clampGlowScale,
  sampleStarPulse,
  type PulseSample,
} from "./star-pulse.ts";
import { createMotionClock } from "./motion-clock.ts";

describe("c32 — glow scale cap", () => {
  it("GLOW_BASE is ~1.25 and CAP is ~1.45", () => {
    assert.ok(Math.abs(GLOW_BASE - 1.25) < 1e-6, `GLOW_BASE=${GLOW_BASE}`);
    assert.ok(Math.abs(GLOW_SCALE_CAP - 1.45) < 1e-6, `CAP=${GLOW_SCALE_CAP}`);
    assert.ok(GLOW_BASE < GLOW_SCALE_CAP);
  });

  it("sampleStarPulse never exceeds CAP (incl. blocked peak + idle)", () => {
    const clock = createMotionClock();
    const out: PulseSample = { scale: 1, glow: 99, emissive: 0 };
    for (const h of ["healthy", "stalled", "blocked", "idle"] as const) {
      for (let i = 0; i < 120; i++) {
        sampleStarPulse(out, 10 + i / 60, i * 0.1, h, false, clock);
        assert.ok(out.glow <= GLOW_SCALE_CAP + 1e-9, `${h} glow ${out.glow}`);
        assert.ok(out.glow >= 0, `${h} negative ${out.glow}`);
      }
      sampleStarPulse(out, 0, 0, h, true, clock);
      assert.ok(out.glow <= GLOW_SCALE_CAP + 1e-9, `RM ${h} ${out.glow}`);
    }
  });

  it("applyFocusPulse with over-boost mul still respects CAP", () => {
    const out: PulseSample = { scale: 1, glow: GLOW_BASE + 0.4, emissive: 0.9 };
    applyFocusPulse(out, 8); // absurd focus mul
    assert.ok(out.glow <= GLOW_SCALE_CAP + 1e-9, `overboost ${out.glow}`);
  });
});

describe("hacker c32 — NaN / Infinity glow inputs", () => {
  it("clampGlowScale sanitizes NaN / ±Inf / negative", () => {
    assert.equal(clampGlowScale(Number.NaN), GLOW_BASE);
    assert.equal(clampGlowScale(Number.POSITIVE_INFINITY), GLOW_SCALE_CAP);
    assert.equal(clampGlowScale(Number.NEGATIVE_INFINITY), 0);
    assert.equal(clampGlowScale(-3), 0);
    assert.equal(clampGlowScale(99), GLOW_SCALE_CAP);
    assert.equal(clampGlowScale(1.3), 1.3);
  });

  it("sampleStarPulse with NaN phase/time stays capped and finite", () => {
    const out: PulseSample = { scale: 1, glow: 99, emissive: 0 };
    sampleStarPulse(out, Number.NaN, Number.NaN, "blocked", false);
    assert.ok(Number.isFinite(out.glow));
    assert.ok(out.glow <= GLOW_SCALE_CAP + 1e-9);
  });
});
