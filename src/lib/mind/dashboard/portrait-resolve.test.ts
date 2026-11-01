import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTRAIT_FALLBACK_URL,
  clearPortraitMissingCacheForTests,
  markPortraitMissing,
  isPortraitMissing,
  portraitUrlForBot,
} from "./portrait-resolve.ts";

describe("portrait-resolve (#19)", () => {
  it("falls back after markPortraitMissing", () => {
    clearPortraitMissingCacheForTests();
    assert.match(portraitUrlForBot("logic"), /portrait-logic\.webp$/);
    markPortraitMissing("logic");
    assert.equal(portraitUrlForBot("logic"), PORTRAIT_FALLBACK_URL);
  });
});


describe("portrait-resolve Gap#40 backoff", () => {
  it("serves fallback during backoff window after markPortraitMissing", () => {
    clearPortraitMissingCacheForTests();
    const t0 = 1_000_000;
    markPortraitMissing("logic", t0);
    assert.equal(portraitUrlForBot("logic", t0 + 1_000), PORTRAIT_FALLBACK_URL);
    // still missing-flagged
    assert.equal(isPortraitMissing("logic"), true);
  });
});
