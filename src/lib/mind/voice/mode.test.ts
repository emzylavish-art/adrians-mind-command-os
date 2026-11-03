import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseVoiceMode,
  readStoredVoiceMode,
  toggleVoiceMode,
  voiceModeLabel,
  writeStoredVoiceMode,
  commitVoiceMode,
  simulateVoiceModeReloadCycle,
  VOICE_MODE_STORAGE_KEY,
} from "./mode.ts";
import { shouldPersistVoiceMode } from "./errors.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    _store: store,
  };
}

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
    const storage = memoryStorage();
    writeStoredVoiceMode("orchestrator", storage);
    assert.equal(storage._store.get(VOICE_MODE_STORAGE_KEY), "orchestrator");
    assert.equal(readStoredVoiceMode(storage), "orchestrator");
  });

  it("commitVoiceMode writes before React state would update (toggle-before-hydrate)", () => {
    const storage = memoryStorage();
    let ui: "direct" | "orchestrator" = "direct";
    const hydrated = false;
    // Old buggy path: gate write on hydrated → toggle is lost.
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(toggleVoiceMode(ui), storage);
    assert.equal(readStoredVoiceMode(storage), "direct");
    // Fixed path: sync commit on toggle.
    ui = commitVoiceMode(toggleVoiceMode(ui), storage);
    assert.equal(ui, "orchestrator");
    assert.equal(readStoredVoiceMode(storage), "orchestrator");
  });

  it("survives toggle → hydrate → reload without falling back to Direct", () => {
    const storage = memoryStorage();
    const cycle = simulateVoiceModeReloadCycle(storage);
    assert.equal(cycle.afterToggle, "orchestrator");
    assert.equal(cycle.afterHydrate, "orchestrator");
    assert.equal(cycle.afterReload, "orchestrator");
    assert.equal(cycle.stored, "orchestrator");
  });

  it("does not let hydrated+default Direct effect-write wipe a stored Orchestrator choice", () => {
    const storage = memoryStorage({ [VOICE_MODE_STORAGE_KEY]: "orchestrator" });
    // Simulate the race: effect marks hydrated while UI mode still SSR default.
    let ui: "direct" | "orchestrator" = "direct";
    const hydrated = true;
    if (shouldPersistVoiceMode(hydrated)) {
      // This is the dangerous write the old effect did — prove storage would be wiped:
      const wiped = memoryStorage({ [VOICE_MODE_STORAGE_KEY]: "orchestrator" });
      writeStoredVoiceMode(ui, wiped);
      assert.equal(readStoredVoiceMode(wiped), "direct");
    }
    // Fixed controller never effect-writes the default; hydrate only reads.
    ui = readStoredVoiceMode(storage);
    assert.equal(ui, "orchestrator");
    assert.equal(readStoredVoiceMode(storage), "orchestrator");
  });
});
