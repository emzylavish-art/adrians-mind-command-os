import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { resetMindRateLimitsForTests } from "../limits.ts";
import { createConsentChallenge } from "./consent.ts";
import { createVoiceCloningService } from "./service.ts";
import { VoiceCloningStore } from "./store.ts";
import type { VoiceCloneProvider } from "./provider.ts";

function fakeWavB64(size = 256): string {
  const n = Math.max(size, 64);
  const buf = Buffer.alloc(44 + n);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n, 40);
  buf.fill(1, 44);
  return buf.toString("base64");
}


function mockProvider(overrides: Partial<VoiceCloneProvider> = {}): VoiceCloneProvider {
  return {
    id: "local-http",
    async status() {
      return {
        provider: "local-http",
        voiceKeyPresent: true,
        canList: true,
        canClone: false,
        reason: "Custom voices are not enabled for this team.",
        banner: "Provider not configured: test",
        probedAt: new Date().toISOString(),
        endpoint: "",
        xaiOptionalEnabled: false,
        watermark: null,
        backend: null,
      };
    },
    async createVoice() {
      return { ok: false, code: "not_configured", error: "Provider not configured: test" };
    },
    async deleteVoice() {
      return { ok: true, deleted: false };
    },
    async synthesize() {
      return { ok: false, error: "Provider not configured: test", code: "not_configured" };
    },
    ...overrides,
  };
}

describe("voice-cloning service delete + consent + export", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetMindRateLimitsForTests();
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  function setup(provider?: VoiceCloneProvider) {
    const dir = mkdtempSync(join(tmpdir(), "vcs-"));
    dirs.push(dir);
    const store = new VoiceCloningStore(dir);
    const svc = createVoiceCloningService({
      store,
      provider: provider ?? mockProvider(),
      apiKey: "xai-test-key-not-real",
      transcribe: async () => ({
        ok: true,
        text: "I consent to clone my voice for Adrian's Mind. Confirmation code AABBCCDD.",
        duration: 1,
      }),
      now: () => 1_700_000_000_000,
    });
    return { store, svc };
  }

  it("create requires consent match; stores profile when provider not configured", async () => {
    const { store, svc } = setup();
    const challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD");
    await store.putChallenge("user-1", challenge);

    const bad = await svc.createProfile("user-1", {
      name: "Home Voice",
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    // STT mock always returns AABBCCDD — should succeed locally with provider_not_configured
    assert.equal(bad.ok, true);
    if (!bad.ok) return;
    assert.equal(bad.profile.providerStatus, "not_configured");
    assert.equal(bad.profile.providerVoiceId, null);
    assert.ok(store.getConsent(bad.profile.consentId));
  });

  it("rejects replayed consent challenge", async () => {
    const { store, svc } = setup();
    const challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD");
    await store.putChallenge("user-1", challenge);
    const first = await svc.createProfile("user-1", {
      name: "Home Voice",
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(first.ok, true);
    const replay = await svc.createProfile("user-1", {
      name: "Home Voice 2",
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.code, "challenge_replay");
  });

  it("generate-after-delete fails cleanly", async () => {
    const ready = mockProvider({
      async status() {
        return {
          provider: "local-http",
          voiceKeyPresent: true,
          canList: true,
          canClone: true,
          reason: "ok",
          banner: "ok",
          probedAt: new Date().toISOString(),
          endpoint: "http://127.0.0.1:7860",
          xaiOptionalEnabled: false,
          watermark: { enabled: true, name: "PerTh", note: "test" },
          backend: "mock-tone",
        };
      },
      async createVoice() {
        return { ok: true, voiceId: "abcd1234" };
      },
      async synthesize() {
        return { ok: true, bytes: new Uint8Array(64).fill(2), mime: "audio/mpeg" };
      },
      async deleteVoice() {
        return { ok: true, deleted: true };
      },
    });
    const { store, svc } = setup(ready);
    const challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD");
    await store.putChallenge("user-1", challenge);
    const created = await svc.createProfile("user-1", {
      name: "Home Voice",
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const gen1 = await svc.generate("user-1", { profileId: created.profile.id, text: "Hello" });
    assert.equal(gen1.ok, true);

    const del = await svc.deleteProfile("user-1", created.profile.id);
    assert.equal(del.ok, true);
    if (del.ok) assert.equal(del.verifiable, true);

    const gen2 = await svc.generate("user-1", { profileId: created.profile.id, text: "Hello again" });
    assert.equal(gen2.ok, false);
    if (!gen2.ok) assert.equal(gen2.code, "not_found");

    // Double-delete is verifiable idempotent success
    const del2 = await svc.deleteProfile("user-1", created.profile.id);
    assert.equal(del2.ok, true);

    const exportAfter = svc.exportGeneratedAudio("user-1", {
      profileId: created.profile.id,
      audioBase64: Buffer.alloc(64).toString("base64"),
      sourceMime: "audio/mpeg",
      format: "mp3",
    });
    assert.equal(exportAfter.ok, false);
    if (!exportAfter.ok) assert.equal(exportAfter.code, "deleted");

    const consentAfter = svc.exportConsentRecord("user-1", created.profile.id);
    assert.equal(consentAfter.ok, false);
    if (!consentAfter.ok) assert.equal(consentAfter.code, "deleted");
  });

  it("export requires verified consent on live profile", async () => {
    const { store, svc } = setup();
    const challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD");
    await store.putChallenge("user-1", challenge);
    const created = await svc.createProfile("user-1", {
      name: "Export Voice",
      attestation: "written_permission",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const exp = svc.exportConsentRecord("user-1", created.profile.id);
    assert.equal(exp.ok, true);
    if (exp.ok) {
      assert.match(exp.filename, /Export_Voice_consent_/);
      assert.match(exp.json, /adrians-mind\.voice-cloning\.consent\.v1/);
      assert.doesNotMatch(exp.json, /Edurain/i);
    }
  });

  it("blocks public figure profile names", async () => {
    const { store, svc } = setup();
    const challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD");
    await store.putChallenge("user-1", challenge);
    const blocked = await svc.createProfile("user-1", {
      name: "Morgan Freeman",
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "blocked_name");
  });
});
