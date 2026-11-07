import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bloomStrengthMultiplier, bloomTier } from "./bloom-policy.ts";

describe("bloom tier", () => {
  it("turns bloom off for reduced motion and save-data", () => {
    assert.equal(bloomTier({ reducedMotion: true }), "off");
    assert.equal(bloomTier({ saveData: true, narrow: false }), "off");
    assert.equal(bloomStrengthMultiplier("off"), 0);
  });

  it("keeps a short pass on narrow and low-power devices", () => {
    assert.equal(bloomTier({ narrow: true }), "low");
    assert.equal(bloomTier({ hardwareConcurrency: 4 }), "low");
    assert.equal(bloomTier({ deviceMemoryGb: 2 }), "low");
    assert.equal(bloomStrengthMultiplier("low"), 0.35);
  });

  it("stays full on a wide desktop", () => {
    assert.equal(bloomTier({ hardwareConcurrency: 8, deviceMemoryGb: 16, narrow: false }), "full");
    assert.equal(bloomStrengthMultiplier("full"), 1);
  });
});
