import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VOICE_MIC_DENIED,
  VOICE_MIC_MISSING,
  VOICE_SIGN_IN_REQUIRED,
  VOICE_START_FAILED,
  formatMicCaptureError,
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
    assert.equal(formatVoiceClientError(new Error("cable unplugged")), "cable unplugged");
  });

  it("maps mic permission and missing-device errors", () => {
    assert.equal(formatMicCaptureError({ name: "NotAllowedError", message: "Permission denied" }), VOICE_MIC_DENIED);
    assert.equal(formatMicCaptureError({ name: "NotFoundError", message: "Requested device not found" }), VOICE_MIC_MISSING);
    assert.equal(formatVoiceClientError(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })), VOICE_MIC_DENIED);
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

    let voiceMode: VoiceRoutingMode = "direct";
    let hydrated = false;
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(voiceMode, storage);
    assert.equal(store.get("amcos.voice.mode.v1"), "orchestrator");

    voiceMode = readStoredVoiceMode(storage);
    hydrated = true;
    assert.equal(voiceMode, "orchestrator");
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(voiceMode, storage);
    assert.equal(store.get("amcos.voice.mode.v1"), "orchestrator");

    voiceMode = "direct";
    if (shouldPersistVoiceMode(hydrated)) writeStoredVoiceMode(voiceMode, storage);
    assert.equal(readStoredVoiceMode(storage), "direct");
  });

  it("rewrites a corrupted localStorage mode to direct", () => {
    const store = new Map<string, string>([["amcos.voice.mode.v1", "%%%garbage%%%"]]);
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    assert.equal(readStoredVoiceMode(storage), "direct");
    assert.equal(store.get("amcos.voice.mode.v1"), "direct");
  });
});
