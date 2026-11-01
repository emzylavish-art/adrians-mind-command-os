import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMonoMotionEnabled } from "./mono-motion-gate.ts";

describe("MonoMotionGraphic gate", () => {
  it("defaults off", () => {
    assert.equal(isMonoMotionEnabled({}), false);
    assert.equal(isMonoMotionEnabled({ VITE_FEATURE_MONO_MOTION: "" }), false);
  });

  it("enables only on explicit truthy flag", () => {
    assert.equal(isMonoMotionEnabled({ VITE_FEATURE_MONO_MOTION: "1" }), true);
    assert.equal(isMonoMotionEnabled({ VITE_FEATURE_MONO_MOTION: "true" }), true);
    assert.equal(isMonoMotionEnabled({ VITE_FEATURE_MONO_MOTION: "yes" }), true);
    assert.equal(isMonoMotionEnabled({ VITE_FEATURE_MONO_MOTION: "0" }), false);
  });
});
