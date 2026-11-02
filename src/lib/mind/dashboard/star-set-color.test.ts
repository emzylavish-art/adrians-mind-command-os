import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampStarEmissive, starSetColorNeedsApply } from "./star-set-color.ts";

describe("clampStarEmissive (c63 / Painter c26 neon fix)", () => {
  it("clamps above 1 down to 1", () => {
    assert.equal(clampStarEmissive(3), 1);
    assert.equal(clampStarEmissive(1.2), 1);
    assert.equal(clampStarEmissive(1), 1);
  });

  it("passes through values in 0..1", () => {
    assert.equal(clampStarEmissive(0), 0);
    assert.equal(clampStarEmissive(0.7), 0.7);
  });

  it("NaN → 0; Infinity clamps like Math.min(1, n)", () => {
    assert.equal(clampStarEmissive(Number.NaN), 0);
    assert.equal(clampStarEmissive(Number.POSITIVE_INFINITY), 1);
    assert.equal(clampStarEmissive(Number.NEGATIVE_INFINITY), 0);
  });
});

describe("starSetColorNeedsApply (change-only)", () => {
  it("applies on first call", () => {
    const r = starSetColorNeedsApply(null, "healthy", 0.8);
    assert.equal(r.apply, true);
    assert.equal(r.emissive, 0.8);
  });

  it("skips when health and clamped emissive unchanged", () => {
    const a = starSetColorNeedsApply(null, "healthy", 0.8);
    const b = starSetColorNeedsApply(a.next, "healthy", 0.8);
    assert.equal(b.apply, false);
  });

  it("applies when health changes", () => {
    const a = starSetColorNeedsApply(null, "healthy", 0.8);
    const b = starSetColorNeedsApply(a.next, "stalled", 0.8);
    assert.equal(b.apply, true);
  });

  it("applies when pulse emissive changes after clamp", () => {
    const a = starSetColorNeedsApply(null, "healthy", 0.5);
    const b = starSetColorNeedsApply(a.next, "healthy", 0.9);
    assert.equal(b.apply, true);
  });

  it("does not thrash when pulse.emissive stays above 1 (clamped equal)", () => {
    const a = starSetColorNeedsApply(null, "healthy", 2.4);
    assert.equal(a.emissive, 1);
    const b = starSetColorNeedsApply(a.next, "healthy", 3);
    assert.equal(b.apply, false);
    assert.equal(b.emissive, 1);
  });
});
