import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHROME_VOICE_READY_NOTE,
  chromeSpeakState,
  decideChromeSpeak,
  mapOverlayPhaseToStageState,
} from "./chrome-actions.ts";

describe("chrome-actions (VOICE-02)", () => {
  it("decideChromeSpeak speaks last reply when idle", () => {
    const d = decideChromeSpeak({ lastReplyContent: " Hello ", speaking: false });
    assert.equal(d.action, "speak");
    if (d.action === "speak") assert.equal(d.text, "Hello");
  });

  it("decideChromeSpeak refuses empty / already speaking", () => {
    assert.equal(decideChromeSpeak({ lastReplyContent: "  ", speaking: false }).action, "none");
    assert.equal(decideChromeSpeak({ lastReplyContent: "hi", speaking: true }).action, "none");
  });

  it("mapOverlayPhaseToStageState covers Direct phases", () => {
    assert.equal(mapOverlayPhaseToStageState("listening"), "listening");
    assert.equal(mapOverlayPhaseToStageState("processing"), "thinking");
    assert.equal(mapOverlayPhaseToStageState("speaking"), "speaking");
    assert.equal(mapOverlayPhaseToStageState("interrupted"), "interrupted");
    assert.equal(mapOverlayPhaseToStageState("error"), "idle");
    assert.equal(mapOverlayPhaseToStageState(undefined), "idle");
  });

  it("chromeSpeakState tracks TTS only", () => {
    assert.equal(chromeSpeakState(false), "off");
    assert.equal(chromeSpeakState(true), "assistant-speaking");
  });

  it("ready note stays honest (no fake connected)", () => {
    assert.match(CHROME_VOICE_READY_NOTE, /Speak reads the last reply/i);
    assert.doesNotMatch(CHROME_VOICE_READY_NOTE, /provider is connected/i);
  });
});
