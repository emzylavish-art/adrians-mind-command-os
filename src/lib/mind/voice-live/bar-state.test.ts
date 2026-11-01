import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { barRootStyle, clampLiveLevel, muteButtonAria } from "./bar-state.ts";
import { phaseToUiAttr } from "./types.ts";

describe("live-voice bar state mapping", () => {
  it("maps session phases onto data-live-voice values", () => {
    assert.equal(phaseToUiAttr("off", false), "off");
    assert.equal(phaseToUiAttr("connecting", false), "connecting");
    assert.equal(phaseToUiAttr("listening", false), "listening");
    assert.equal(phaseToUiAttr("user_speaking", false), "user-speaking");
    assert.equal(phaseToUiAttr("assistant_speaking", false), "assistant-speaking");
    assert.equal(phaseToUiAttr("interrupted", false), "interrupted");
    assert.equal(phaseToUiAttr("listening", true), "muted");
    assert.equal(phaseToUiAttr("error", false), "error");
  });

  it("clamps --live-level and mute aria labels", () => {
    assert.equal(clampLiveLevel(undefined), 0);
    assert.equal(clampLiveLevel(1.7), 1);
    assert.equal(clampLiveLevel(-2), 0);
    assert.equal(clampLiveLevel(0.456), 0.46);
    assert.deepEqual(muteButtonAria(false, false), { label: "Start live voice", pressed: false });
    assert.deepEqual(muteButtonAria(true, false), { label: "Mute", pressed: false });
    assert.deepEqual(muteButtonAria(true, true), { label: "Unmute", pressed: true });
    assert.equal(barRootStyle(0.5)["--live-level"], "0.5");
  });
});
