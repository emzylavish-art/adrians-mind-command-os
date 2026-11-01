import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VOICE_SIGN_IN_REQUIRED,
  VOICE_START_FAILED,
  formatVoiceClientError,
  shouldPersistVoiceMode,
} from "./errors.ts";
import { readStoredVoiceMode, writeStoredVoiceMode, type VoiceRoutingMode } from "./mode.ts";

describe("formatVoiceClientError", () => {
  it("surfaces Unauthorized as a visible sign-in message", () => {
    assert.equal(formatVoiceClientError(new Error("Unauthorized")), VOICE_SIGN_IN_REQUIRED);
    assert.equal(formatVoiceClientError({ ok: false, error: "Unauthorized" }), VOICE_SIGN_IN_REQUIRED);
  });

  it("never returns an empty string", () => {
    assert.equal(formatVoiceClientError(null), VOICE_START_FAILED);
    assert.equal(formatVoiceClientError(""), VOICE_START_FAILED);
    assert.equal(formatVoiceClientError(new Error("mic denied")), "mic denied");
  });
});

describe("voice mode persistence hydrate gate", () => {
  it("does not let the SSR default overwrite a stored Orchestrator choice before hydrate", () => {
    const store = new Map<string, string>([["amcos.voice.mode.v1", "orchestrator"]]);
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    // Simulate first render default + the buggy immediate write of "direct".
    let voiceMode: VoiceRoutingMode = "direct";
    let hydrated = false;
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(voiceMode, storage);
    assert.equal(store.get("amcos.voice.mode.v1"), "orchestrator");

    // Hydrate from storage, then allow persistence.
    voiceMode = readStoredVoiceMode(storage);
    hydrated = true;
    assert.equal(voiceMode, "orchestrator");
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(voiceMode, storage);
    assert.equal(store.get("amcos.voice.mode.v1"), "orchestrator");

    // User toggles to Direct after hydrate — that may persist.
    voiceMode = "direct";
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(voiceMode, storage);
    assert.equal(readStoredVoiceMode(storage), "direct");
  });
});
