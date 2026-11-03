import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindPresentationalLiveVoiceBar,
  FORBIDDEN_MARK_PREVIEW_LIVE_BAR,
  LIVE_VOICE_NOT_CONNECTED_NOTICE,
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
      onModeSwitch: () => calls.push("mode"),
      onNotice: (m) => calls.push(`notice:${m}`),
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
    bound.onModeSwitch();
    assert.deepEqual(calls, [
      "mute",
      "end:Live voice ended.",
      "speaker",
      "screen",
      "settings",
      "plus",
      "plusItem:camera",
      "ask",
      "mode",
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

  it("notices honestly when mute/end/speaker/screen/mode fire without a live session", () => {
    const calls: string[] = [];
    const bound = bindPresentationalLiveVoiceBar({
      session: {
        toggleMute: () => calls.push("mute"),
        end: () => calls.push("end"),
        toggleSpeaker: () => calls.push("speaker"),
        active: false,
        uiAttr: "off",
        phase: "off",
      },
      onScreenShare: () => calls.push("screen"),
      onSettings: () => calls.push("settings"),
      onPlus: () => calls.push("plus"),
      onModeSwitch: () => calls.push("mode"),
      onNotice: (m) => calls.push(`notice:${m}`),
    });

    bound.onMute();
    bound.onEnd();
    bound.onSpeaker();
    bound.onScreenShare();
    bound.onModeSwitch();
    // Settings/plus remain available while idle (composer chrome).
    bound.onSettings();
    bound.onPlus();

    assert.deepEqual(calls, [
      `notice:${LIVE_VOICE_NOT_CONNECTED_NOTICE}`,
      `notice:${LIVE_VOICE_NOT_CONNECTED_NOTICE}`,
      `notice:${LIVE_VOICE_NOT_CONNECTED_NOTICE}`,
      `notice:${LIVE_VOICE_NOT_CONNECTED_NOTICE}`,
      `notice:${LIVE_VOICE_NOT_CONNECTED_NOTICE}`,
      "settings",
      "plus",
    ]);
  });

  it("treats connecting phase as live so mute/end stay real", () => {
    const calls: string[] = [];
    const bound = bindPresentationalLiveVoiceBar({
      session: {
        toggleMute: () => calls.push("mute"),
        end: (n) => calls.push(`end:${n ?? ""}`),
        toggleSpeaker: () => calls.push("speaker"),
        active: false,
        phase: "connecting",
        uiAttr: "connecting",
      },
      onScreenShare: () => calls.push("screen"),
      onSettings: () => undefined,
      onPlus: () => undefined,
      onNotice: (m) => calls.push(`notice:${m}`),
    });
    bound.onMute();
    bound.onEnd();
    assert.deepEqual(calls, ["mute", "end:Live voice ended."]);
  });
});
