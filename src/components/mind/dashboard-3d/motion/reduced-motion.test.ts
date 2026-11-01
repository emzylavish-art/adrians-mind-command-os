import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { motionScale, prefersReducedMotion } from "./reduced-motion.ts";

describe("reduced-motion", () => {
  it("prefersReducedMotion reads matchMedia", () => {
    assert.equal(
      prefersReducedMotion(() => ({ matches: true })),
      true,
    );
    assert.equal(
      prefersReducedMotion(() => ({ matches: false })),
      false,
    );
  });

  it("motionScale zeros when reduced", () => {
    assert.equal(motionScale(true), 0);
    assert.equal(motionScale(false), 1);
    assert.equal(motionScale(false, 0.5), 0.5);
    assert.equal(motionScale(false, 2), 1);
  });
});
