import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseVoiceMode, readStoredVoiceMode, toggleVoiceMode, voiceModeLabel, writeStoredVoiceMode, VOICE_MODE_STORAGE_KEY } from "./mode.ts";

describe("voice mode", () => {
  it("parses and toggles modes", () => {
    assert.equal(parseVoiceMode("orchestrator"), "orchestrator");
    assert.equal(parseVoiceMode("direct"), "direct");
    assert.equal(parseVoiceMode("nope"), "direct");
    assert.equal(toggleVoiceMode("direct"), "orchestrator");
    assert.equal(toggleVoiceMode("orchestrator"), "direct");
    assert.equal(voiceModeLabel("direct"), "Direct");
    assert.equal(voiceModeLabel("orchestrator"), "Orchestrator");
  });

  it("persists through a storage stub", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    writeStoredVoiceMode("orchestrator", storage);
    assert.equal(store.get(VOICE_MODE_STORAGE_KEY), "orchestrator");
    assert.equal(readStoredVoiceMode(storage), "orchestrator");
  });
});
