import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clamp01, damp, easeInOutCubic, easeOutQuint, lerp, smootherstep } from "./ease.ts";

describe("ease", () => {
  it("clamp01 bounds", () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(0.4), 0.4);
  });

  it("easeInOutCubic endpoints and midpoint", () => {
    assert.equal(easeInOutCubic(0), 0);
    assert.equal(easeInOutCubic(1), 1);
    assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9);
  });

  it("easeOutQuint starts slow relative to linear mid", () => {
    assert.equal(easeOutQuint(0), 0);
    assert.equal(easeOutQuint(1), 1);
    assert.ok(easeOutQuint(0.5) > 0.5);
  });

  it("smootherstep flat at ends", () => {
    assert.equal(smootherstep(0), 0);
    assert.equal(smootherstep(1), 1);
    assert.ok(smootherstep(0.2) < 0.2);
  });

  it("damp approaches target", () => {
    let v = 0;
    for (let i = 0; i < 40; i++) v = damp(v, 10, 8, 1 / 60);
    assert.ok(Math.abs(v - 10) < 0.05);
  });

  it("lerp", () => {
    assert.equal(lerp(0, 10, 0.5), 5);
  });
});
