import assert from "node:assert/strict";
import test from "node:test";
import { followBottom, iphoneStillRequired, layoutShift, menuCloseMs, menuOpenMs } from "./chat-motion.ts";

test("send scroll follows only when already near the bottom", () => {
  assert.equal(followBottom(0), true);
  assert.equal(followBottom(96), true);
  assert.equal(followBottom(97), false);
});

test("layout shift ignores input-driven entries and sums the rest", () => {
  assert.equal(layoutShift([{ value: 0.02 }, { value: 0.2, hadRecentInput: true }]), 0.02);
});

test("menu timing is not a one-frame cut", () => {
  assert.equal(menuOpenMs, 180);
  assert.equal(menuCloseMs, 150);
  assert.equal(iphoneStillRequired.length, 5);
});
