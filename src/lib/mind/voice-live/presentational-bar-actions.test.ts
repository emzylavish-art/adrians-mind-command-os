import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindPresentationalLiveVoiceBar,
  FORBIDDEN_MARK_PREVIEW_LIVE_BAR,
} from "./presentational-bar-actions.ts";

describe("bindPresentationalLiveVoiceBar", () => {
  it("routes mute/end/speaker into the shared session (not markPreview)", () => {
    const calls: string[] = [];
    const bound = bindPresentationalLiveVoiceBar({
      session: {
        toggleMute: () => calls.push("mute"),
        end: (n) => calls.push(`end:${n ?? ""}`),
        toggleSpeaker: () => calls.push("speaker"),
        uiAttr: "listening",
        level: 0.4,
        active: true,
      },
      onScreenShare: () => calls.push("screen"),
      onSettings: () => calls.push("settings"),
      onPlus: () => calls.push("plus"),
      onPlusItem: (id) => calls.push(`plusItem:${id}`),
      onAskFocus: () => calls.push("ask"),
    });

    assert.equal(bound.state, "listening");
    assert.equal(bound.level, 0.4);
    bound.onMute();
    bound.onEnd();
    bound.onSpeaker();
    bound.onScreenShare();
    bound.onSettings();
    bound.onPlus();
    bound.onPlusItem("camera");
    bound.onAskFocus();
    assert.deepEqual(calls, [
      "mute",
      "end:Live voice ended.",
      "speaker",
      "screen",
      "settings",
      "plus",
      "plusItem:camera",
      "ask",
    ]);
  });

  it("surfaces muted state for the presentational bar", () => {
    const bound = bindPresentationalLiveVoiceBar({
      session: {
        toggleMute: () => undefined,
        end: () => undefined,
        toggleSpeaker: () => undefined,
        muted: true,
        uiAttr: "listening",
        active: true,
      },
      onScreenShare: () => undefined,
      onSettings: () => undefined,
      onPlus: () => undefined,
    });
    assert.equal(bound.state, "muted");
  });

  it("lists forbidden markPreview labels for regression guards", () => {
    assert.ok(FORBIDDEN_MARK_PREVIEW_LIVE_BAR.includes("Live bar mute"));
    assert.ok(FORBIDDEN_MARK_PREVIEW_LIVE_BAR.includes("Screen share"));
    assert.ok(FORBIDDEN_MARK_PREVIEW_LIVE_BAR.includes("Voice settings"));
  });
});
