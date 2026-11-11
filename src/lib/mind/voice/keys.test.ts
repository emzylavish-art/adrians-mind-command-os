import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readVoiceSecretsFile, resolveVoiceApiKey, voiceKeyConfigured } from "./keys.ts";

describe("voice keys", () => {
  it("reads the box-style secrets file", () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-keys-"));
    const path = join(dir, "xai_voice.env");
    writeFileSync(path, "XAI_VOICE_API_KEY=xai-test-from-file\n");
    try {
      assert.equal(readVoiceSecretsFile(path), "xai-test-from-file");
      const env: Record<string, string | undefined> = {};
      assert.equal(resolveVoiceApiKey(env, path), "xai-test-from-file");
      assert.equal(env.XAI_VOICE_API_KEY, "xai-test-from-file");
      assert.equal(voiceKeyConfigured({}, path), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers env over the secrets file", () => {
    const dir = mkdtempSync(join(tmpdir(), "voice-keys-"));
    const path = join(dir, "xai_voice.env");
    writeFileSync(path, "XAI_VOICE_API_KEY=xai-from-file\n");
    try {
      assert.equal(resolveVoiceApiKey({ XAI_VOICE_API_KEY: "xai-from-env" }, path), "xai-from-env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the model key only when no speech key exists and it is not the management key", () => {
    assert.equal(resolveVoiceApiKey({ XAI_API_KEY: "xai-model" }, "/tmp/missing-voice-secrets"), "xai-model");
    assert.equal(resolveVoiceApiKey({ XAI_API_KEY: "xai-same", XAI_MANAGEMENT_KEY: "xai-same" }, "/tmp/missing-voice-secrets"), undefined);
    assert.equal(resolveVoiceApiKey({ XAI_VOICE_API_KEY: "xai-voice", XAI_API_KEY: "xai-model" }, "/tmp/missing-voice-secrets"), "xai-voice");
  });
});
