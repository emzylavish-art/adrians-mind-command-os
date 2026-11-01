import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_VOICE_SETTINGS,
  liveVoiceMissingNotice,
  loadVoiceSettings,
  saveVoiceSettings,
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

  it("labels unused prefs until live voice is connected", () => {
    assert.match(unusedUntilLiveNotice(), /not used until live voice/i);
  });

  it("refuses live voice without a provider key", () => {
    assert.match(liveVoiceMissingNotice(false), /XAI_API_KEY/);
  });
});
