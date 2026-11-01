import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_LIVE_TRANSCRIPT_CHARS,
  clampLiveTranscript,
  resolveLiveTranscriptDisplay,
  shouldClearLiveTranscriptOnModeSwitch,
} from "./live-transcript.ts";

describe("live transcript harden", () => {
  it("renders as plain text and caps length", () => {
    assert.equal(clampLiveTranscript("<b>hi</b>"), "<b>hi</b>");
    assert.equal(clampLiveTranscript("a".repeat(MAX_LIVE_TRANSCRIPT_CHARS + 50)).length, MAX_LIVE_TRANSCRIPT_CHARS);
    assert.equal(clampLiveTranscript("\u0000hello\u0007"), "hello");
    assert.equal(clampLiveTranscript(null), "");
  });

  it("prefers final over interim and clears on mode switch", () => {
    assert.equal(resolveLiveTranscriptDisplay({ interim: "hel", final: "hello" }), "hello");
    assert.equal(resolveLiveTranscriptDisplay({ interim: "hel", final: "" }), "hel");
    assert.equal(shouldClearLiveTranscriptOnModeSwitch("direct", "orchestrator"), true);
    assert.equal(shouldClearLiveTranscriptOnModeSwitch("direct", "direct"), false);
  });
});
