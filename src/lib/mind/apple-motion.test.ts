import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APPLE_EASE, APPLE_MOTION, appleMotionCss } from "./apple-motion.ts";

describe("appleMotionCss", () => {
  it("uses one Apple ease and four categorized durations", () => {
    const css = appleMotionCss();
    assert.equal(APPLE_EASE, "cubic-bezier(0.32, 0.72, 0, 1)");
    assert.equal(css.split(APPLE_EASE).length - 1, 3);
    assert.match(css, new RegExp(APPLE_MOTION.press));
    assert.match(css, new RegExp(APPLE_MOTION.control));
    assert.match(css, new RegExp(APPLE_MOTION.surface));
    assert.match(css, new RegExp(APPLE_MOTION.overlay));
  });

  it("does not animate layout or position", () => {
    const css = appleMotionCss();
    for (const banned of ["transform", "width", "height", "top", "left", "right", "bottom", "margin", "padding", "scroll-behavior"]) {
      assert.equal(css.includes(banned), false, banned);
    }
  });

  it("turns movement off when reduced motion is requested", () => {
    const css = appleMotionCss();
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /transition: none !important/);
    assert.match(css, /animation: none !important/);
  });
});
