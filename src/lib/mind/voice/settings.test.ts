import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_VOICE_SETTINGS,
  liveVoiceMissingNotice,
  loadVoiceSettings,
  saveVoiceSettings,
  savedOnThisDeviceNotice,
  unusedUntilLiveNotice,
  VOICE_SETTINGS_KEY,
} from "./settings.ts";

describe("voice settings", () => {
  it("round-trips settings in storage without inventing devices", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    const next = { ...DEFAULT_VOICE_SETTINGS, personality: "therapist" as const, openInVoiceMode: true };
    saveVoiceSettings(storage, next);
    assert.ok(mem.get(VOICE_SETTINGS_KEY));
    const loaded = loadVoiceSettings(storage);
    assert.equal(loaded.personality, "therapist");
    assert.equal(loaded.openInVoiceMode, true);
    assert.equal(loaded.microphoneId, "");
  });

  it("labels prefs as saved on this device", () => {
    assert.match(unusedUntilLiveNotice(), /Saved on this device/i);
    assert.match(savedOnThisDeviceNotice(), /Saved on this device/i);
  });

  it("refuses live voice without a provider key", () => {
    assert.match(liveVoiceMissingNotice(false), /not configured/i);
    assert.match(liveVoiceMissingNotice(false), /speech key/i);
  });
});
