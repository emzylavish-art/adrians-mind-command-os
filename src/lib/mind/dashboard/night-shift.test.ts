import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNightShiftActive, nightShiftFloors, NIGHT_SHIFT_MS } from "./night-shift.ts";

const NOW = Date.parse("2026-11-01T21:00:00+01:00");

describe("night-shift (queue #18)", () => {
  it("activates only within 30m of real lastActivityAt", () => {
    assert.equal(isNightShiftActive(null, NOW), false);
    assert.equal(isNightShiftActive("garbage", NOW), false);
    assert.equal(isNightShiftActive(new Date(NOW - 5 * 60_000).toISOString(), NOW), true);
    assert.equal(isNightShiftActive(new Date(NOW - NIGHT_SHIFT_MS - 60_000).toISOString(), NOW), false);
  });

  it("returns upper floors when active; empty when idle; steady under reduced-motion", () => {
    const on = nightShiftFloors({
      floors: 9,
      lastActivityAt: new Date(NOW - 60_000).toISOString(),
      nowMs: NOW,
    });
    assert.equal(on.active, true);
    assert.ok(on.floors.length > 0);
    assert.ok(on.floors.every((f) => f >= 1 && f < 9));

    const off = nightShiftFloors({ floors: 9, lastActivityAt: null, nowMs: NOW });
    assert.equal(off.active, false);
    assert.deepEqual(off.floors, []);

    const rm = nightShiftFloors({
      floors: 9,
      lastActivityAt: new Date(NOW - 60_000).toISOString(),
      nowMs: NOW,
      reducedMotion: true,
    });
    assert.equal(rm.steady, true);
  });
});
