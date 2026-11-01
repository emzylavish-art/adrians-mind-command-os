import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_XAI_VOICE,
  XAI_BUILTIN_VOICES,
  XAI_VOICE_DOCS_URL,
  VOICE_CHOICE_STORAGE_KEY,
  isAllowedXaiVoice,
  readStoredVoiceChoice,
  resolveXaiVoiceId,
  writeStoredVoiceChoice,
} from "./voices.ts";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("xAI voice picker allowlist", () => {
  it("cites docs and includes official names", () => {
    assert.equal(XAI_VOICE_DOCS_URL, "https://docs.x.ai/docs/guides/voice");
    assert.ok(XAI_BUILTIN_VOICES.includes("eve"));
    assert.ok(XAI_BUILTIN_VOICES.includes("ara"));
    assert.ok(XAI_BUILTIN_VOICES.includes("leo"));
    assert.ok(XAI_BUILTIN_VOICES.includes("rex"));
    assert.ok(XAI_BUILTIN_VOICES.includes("sal"));
    assert.equal(DEFAULT_XAI_VOICE, "eve");
  });

  it("falls back on corrupt storage and rewrites", () => {
    assert.equal(resolveXaiVoiceId("not-a-voice"), "eve");
    assert.equal(isAllowedXaiVoice("eve"), true);
    assert.equal(isAllowedXaiVoice("bogus"), false);
    const storage = memoryStorage({ [VOICE_CHOICE_STORAGE_KEY]: "CORRUPT!!!" });
    assert.equal(readStoredVoiceChoice(storage), "eve");
    assert.equal(storage._map.get(VOICE_CHOICE_STORAGE_KEY), "eve");
    assert.equal(writeStoredVoiceChoice("leo", storage), "leo");
    assert.equal(storage._map.get(VOICE_CHOICE_STORAGE_KEY), "leo");
  });
});
