import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetAppearance, resetVoice, THEME_KEY, FAILOVER_KEY, SPEAK_RATE_KEY, APPEARANCE_DEFAULTS, VOICE_DEFAULTS } from "./settings-reset.ts";
import { loadVoiceSettings, saveVoiceSettings, VOICE_SETTINGS_KEY } from "./voice/settings.ts";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe("settings section reset", () => {
  it("returns appearance to the documented defaults and leaves voice stored", () => {
    const storage = memory();
    storage.setItem(THEME_KEY, "light");
    storage.setItem(FAILOVER_KEY, "grok");
    storage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ ...VOICE_DEFAULTS, speed: "fast" }));
    resetAppearance(storage);
    assert.equal(storage.getItem(THEME_KEY), APPEARANCE_DEFAULTS.theme);
    assert.equal(storage.getItem(FAILOVER_KEY), APPEARANCE_DEFAULTS.failover);
    assert.equal(JSON.parse(storage.getItem(VOICE_SETTINGS_KEY) || "{}").speed, "fast");
  });

  it("returns voice to the documented defaults and leaves appearance stored", () => {
    const storage = memory();
    storage.setItem(THEME_KEY, "light");
    storage.setItem(FAILOVER_KEY, "grok");
    storage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ ...VOICE_DEFAULTS, speed: "fast", personality: "therapist" }));
    storage.setItem(SPEAK_RATE_KEY, "brisk");
    resetVoice(storage);
    assert.equal(storage.getItem(THEME_KEY), "light");
    assert.equal(storage.getItem(FAILOVER_KEY), "grok");
    const voice = JSON.parse(storage.getItem(VOICE_SETTINGS_KEY) || "{}");
    assert.equal(voice.speed, "normal");
    assert.equal(voice.personality, "adrian");
    assert.equal(voice.voiceId, "eve");
    assert.equal(storage.getItem(SPEAK_RATE_KEY), "natural");
  });
});

it("keeps Push to Talk across both controls and clears legacy activation on reset", () => {
  const storage = memory();
  storage.setItem("adrian-speak-activation", "push");
  assert.equal(loadVoiceSettings(storage).activation, "push_to_talk");
  saveVoiceSettings(storage, { ...VOICE_DEFAULTS, activation: "isolation" });
  assert.equal(loadVoiceSettings(storage).activation, "isolation");
  saveVoiceSettings(storage, { ...VOICE_DEFAULTS, activation: "push_to_talk" });
  assert.equal(storage.getItem("adrian-speak-activation"), "push");
  resetVoice(storage);
  assert.equal(loadVoiceSettings(storage).activation, "default");
  assert.equal(storage.getItem("adrian-speak-activation"), "default");
});
