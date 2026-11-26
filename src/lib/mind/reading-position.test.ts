import test from "node:test";
import assert from "node:assert/strict";
import { messageWindow, nextReadingPosition } from "./reading-position.ts";
test("stream growth preserves following but text selection/upward reading detaches", () => {
  assert.equal(nextReadingPosition({ top: 500, following: true }, { top: 500, height: 1500, viewport: 500 }).following, true);
  assert.equal(nextReadingPosition({ top: 500, following: true }, { top: 490, height: 1500, viewport: 500 }).following, false);
  assert.equal(nextReadingPosition({ top: 500, following: true }, { top: 500, height: 1000, viewport: 500, userReading: true }).following, false);
});
test("bounded render window preserves all original messages and expands explicitly", () => {
  const all = Array.from({ length: 1000 }, (_, i) => i);
  assert.equal(messageWindow(all).length, 80); assert.equal(messageWindow(all)[0], 920);
  assert.equal(messageWindow(all, 160)[0], 840); assert.equal(all.length, 1000);
});

test("layout clamping does not detach tail-following or reattach an intentional reader", () => {
  assert.equal(nextReadingPosition({ top: 500, following: true }, { top: 300, height: 1500, viewport: 500, userInitiated: false }).following, true);
  assert.equal(nextReadingPosition({ top: 500, following: false }, { top: 300, height: 800, viewport: 500, userInitiated: false }).following, false);
  assert.equal(nextReadingPosition({ top: 500, following: true }, { top: 300, height: 1500, viewport: 500, userInitiated: true }).following, false);
});
