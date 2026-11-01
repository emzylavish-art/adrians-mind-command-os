import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { levelToBarPercents, rmsLevel } from "./levels.ts";

describe("voice levels", () => {
  it("returns 0 for silence", () => {
    assert.equal(rmsLevel(new Float32Array(64)), 0);
  });

  it("rises for a loud tone", () => {
    const samples = new Float32Array(64);
    for (let i = 0; i < samples.length; i++) samples[i] = i % 2 === 0 ? 0.9 : -0.9;
    assert.ok(rmsLevel(samples) > 0.5);
  });

  it("maps levels into bar percents", () => {
    const quiet = levelToBarPercents(0, 5);
    const loud = levelToBarPercents(1, 5);
    assert.equal(quiet.length, 5);
    assert.ok(loud.every((h, i) => h >= quiet[i]!));
  });
});
