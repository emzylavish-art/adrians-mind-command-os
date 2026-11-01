import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PORTRAIT_FALLBACK_URL,
  clearPortraitMissingCacheForTests,
  markPortraitMissing,
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
