import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOOM_BY_TONE, BLOOM_MAX_EDGE, bloomParamsForTone, safeBloomSize } from "./bloom-tuning.ts";

describe("bloom-tuning", () => {
  it("blocked bloom is stronger than healthy/idle", () => {
    assert.ok(BLOOM_BY_TONE.blocked.strength > BLOOM_BY_TONE.healthy.strength);
    assert.ok(BLOOM_BY_TONE.healthy.strength > BLOOM_BY_TONE.idle.strength);
    assert.ok(BLOOM_BY_TONE.blocked.threshold < BLOOM_BY_TONE.idle.threshold);
  });

  it("bloomParamsForTone returns a copy", () => {
    const a = bloomParamsForTone("stalled");
    a.strength = 999;
    assert.notEqual(BLOOM_BY_TONE.stalled.strength, 999);
  });

  it("safeBloomSize clamps 0/NaN/high-DPR edges", () => {
    assert.deepEqual(safeBloomSize(0, 0), [1, 1]);
    assert.deepEqual(safeBloomSize(Number.NaN, 1080), [1, 1080]);
    const [w, h] = safeBloomSize(1920 * 3, 1080 * 3);
    assert.equal(w, BLOOM_MAX_EDGE);
    assert.ok(h <= BLOOM_MAX_EDGE && h >= 1);
  });
});
