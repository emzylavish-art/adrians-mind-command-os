import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phaseToLabel, phaseToUiAttr, throttleLiveLevel } from "./types.ts";
import { reduceLivePhaseAfterEvent } from "./live-session.ts";

describe("voice-live state mapping", () => {
  it("maps phases to Visual Polish data-live-voice attrs", () => {
    assert.equal(phaseToUiAttr("connecting", false), "connecting");
    assert.equal(phaseToUiAttr("user_speaking", false), "user-speaking");
    assert.equal(phaseToUiAttr("assistant_speaking", false), "assistant-speaking");
    assert.equal(phaseToUiAttr("interrupted", false), "interrupted");
    assert.equal(phaseToUiAttr("listening", true), "muted");
    assert.equal(phaseToLabel("thinking", false), "Thinking");
    assert.equal(phaseToLabel("user_speaking", false), "You're speaking");
  });

  it("state machine transitions for speech/barge/response", () => {
    assert.equal(reduceLivePhaseAfterEvent("listening", "speech_started"), "user_speaking");
    assert.equal(reduceLivePhaseAfterEvent("assistant_speaking", "barge_cut"), "interrupted");
    assert.equal(reduceLivePhaseAfterEvent("user_speaking", "speech_stopped"), "thinking");
    assert.equal(reduceLivePhaseAfterEvent("thinking", "audio_delta"), "assistant_speaking");
    assert.equal(reduceLivePhaseAfterEvent("assistant_speaking", "response_done"), "listening");
  });

  it("throttles level to ~15Hz and rounds to 2 decimals", () => {
    const a = throttleLiveLevel(0, 10, 0.1234);
    assert.equal(a.emit, true);
    assert.equal(a.value, 0.12);
    const b = throttleLiveLevel(a.at, a.at + 10, 0.5);
    assert.equal(b.emit, false);
    const c = throttleLiveLevel(a.at, a.at + 70, 0.987);
    assert.equal(c.emit, true);
    assert.equal(c.value, 0.99);
  });
});
