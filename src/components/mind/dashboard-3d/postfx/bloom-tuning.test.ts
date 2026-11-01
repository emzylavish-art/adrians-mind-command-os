import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BLOOM_BY_TONE, bloomParamsForTone } from "./bloom-tuning.ts";

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
});
