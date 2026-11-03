import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VOICE_MODE_STORAGE_KEY } from "./mode.ts";
import {
  getVoiceMode,
  hydrateVoiceModeStore,
  setVoiceModeStore,
  subscribeVoiceMode,
} from "./mode-store.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    _map: map,
  };
}

describe("voice mode store (single source of truth)", () => {
  it("hydrates once and serves the same value to every subscriber", () => {
    const storage = memoryStorage({ [VOICE_MODE_STORAGE_KEY]: "orchestrator" });
    hydrateVoiceModeStore(storage);
    assert.equal(getVoiceMode(), "orchestrator");
    const seen: string[] = [];
    const unsub = subscribeVoiceMode(() => seen.push(getVoiceMode()));
    setVoiceModeStore("direct", storage);
    setVoiceModeStore("orchestrator", storage);
    unsub();
    assert.deepEqual(seen, ["direct", "orchestrator"]);
    assert.equal(storage._map.get(VOICE_MODE_STORAGE_KEY), "orchestrator");
    assert.equal(getVoiceMode(), "orchestrator");
  });

  it("keeps badges aligned: two readers always see the same mode after toggle", () => {
    const storage = memoryStorage();
    hydrateVoiceModeStore(storage);
    // Simulate home badge + thread badge both reading the store.
    const home = () => getVoiceMode();
    const thread = () => getVoiceMode();
    assert.equal(home(), "direct");
    assert.equal(thread(), "direct");
    setVoiceModeStore("orchestrator", storage);
    assert.equal(home(), "orchestrator");
    assert.equal(thread(), "orchestrator");
  });
});
