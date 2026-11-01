import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampSpeakText,
  MAX_SPEAK_CHARS,
  MAX_VOICE_TRANSCRIPT_CHARS,
  sanitizeVoiceTranscript,
  stripControlChars,
} from "./limits.ts";

describe("voice limits", () => {
  it("rejects empty/garbage and huge transcripts with visible errors", () => {
    assert.equal(sanitizeVoiceTranscript("   ").ok, false);
    assert.equal(sanitizeVoiceTranscript(null).ok, false);
    const cleaned = sanitizeVoiceTranscript("\u0000hi\u0007there");
    assert.equal(cleaned.ok, true);
    if (cleaned.ok) assert.equal(cleaned.text, "hithere");
    const huge = "a".repeat(MAX_VOICE_TRANSCRIPT_CHARS + 1);
    const bad = sanitizeVoiceTranscript(huge);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /too long/);
  });

  it("clamps Speak text and strips controls", () => {
    assert.equal(stripControlChars("a\u0000b"), "ab");
    assert.equal(clampSpeakText("  hi  "), "hi");
    assert.equal(clampSpeakText("x".repeat(MAX_SPEAK_CHARS + 50)).length, MAX_SPEAK_CHARS);
  });
});
