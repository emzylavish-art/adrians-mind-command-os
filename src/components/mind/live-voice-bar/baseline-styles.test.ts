import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LIVE_VOICE_BASELINE_CSS, ensureLiveVoiceBaselineStyles, resetLiveVoiceBaselineStylesForTests } from "./baseline-styles.ts";

describe("live voice baseline styles", () => {
  it("includes fixed bottom-zone rules so the bar is not off-screen without VP CSS", () => {
    assert.match(LIVE_VOICE_BASELINE_CSS, /\.composer-bar\.is-fixed/);
    assert.match(LIVE_VOICE_BASELINE_CSS, /position:\s*fixed/);
    assert.match(LIVE_VOICE_BASELINE_CSS, /\.live-voice-bar/);
    assert.match(LIVE_VOICE_BASELINE_CSS, /z-index:\s*40/);
  });

  it("is a no-op without a document (SSR / node tests)", () => {
    resetLiveVoiceBaselineStylesForTests();
    assert.equal(ensureLiveVoiceBaselineStyles(null), false);
  });
});
