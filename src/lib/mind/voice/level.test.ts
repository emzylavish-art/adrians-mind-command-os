import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { levelToBarPercents, meterValue, rmsFromFloatSamples, rmsFromTimeDomain } from "./level.ts";

describe("voice level meter math", () => {
  it("returns 0 for empty or silence byte buffers", () => {
    assert.equal(rmsFromTimeDomain([]), 0);
    assert.equal(rmsFromTimeDomain(new Array(32).fill(128)), 0);
  });

  it("rises for loud time-domain bytes", () => {
    const loud = new Array(32).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 255));
    assert.ok(rmsFromTimeDomain(loud) > 0.5);
  });

  it("computes float RMS and clamps meterValue", () => {
    assert.equal(rmsFromFloatSamples([]), 0);
    assert.ok(rmsFromFloatSamples([1, -1, 1, -1]) > 0.9);
    assert.equal(meterValue(false, 0.9), 0);
    assert.equal(meterValue(true, 1.5), 1);
    assert.equal(meterValue(true, Number.NaN), 0);
  });

  it("maps level to bar percents with idle-flat via meterValue", () => {
    const idle = levelToBarPercents(meterValue(false, 0.8), 5);
    assert.equal(idle.length, 5);
    assert.ok(idle.every((h) => h <= 12));
    const live = levelToBarPercents(meterValue(true, 0.8), 5);
    assert.ok(Math.max(...live) > Math.max(...idle));
  });
});
