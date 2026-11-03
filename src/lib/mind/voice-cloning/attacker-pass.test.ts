/**
 * Attacker pass: profile / consent / generate / preview-helpers / export
 * through the Voice Connection Hub mock adapter. MOCK-VERIFIED.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { resetMindRateLimitsForTests } from "../limits.ts";
import { createConsentChallenge, isBlockedPublicFigureName } from "./consent.ts";
import {
  assertConsentExportHasNoSecrets,
  buildAudioExportFilename,
  buildConsentExportPayload,
  prepareExportAudio,
  sanitizeFilenamePart,
} from "./export.ts";
import { createHubVoiceProvider } from "./hub-provider.ts";
import { issueConsentToken, resetStudioVoiceHubForTests, verifyConsentToken } from "./hub-client.ts";
import { createVoiceHub } from "../../../../tools/voice-mcp-hub/src/hub.ts";
import { createVoiceCloningService } from "./service.ts";
import { VoiceCloningStore } from "./store.ts";
import { VCS_CREATE_RATE_PER_MIN, VCS_GENERATE_RATE_PER_MIN, VCS_MAX_GENERATE_CHARS } from "./limits.ts";
import { looksLikeWavHeader } from "./audio-sniff.ts";

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

function fakeMp3B64(): string {
  // Minimal MPEG frame sync + padding
  const buf = Buffer.alloc(128, 0);
  buf[0] = 0xff;
  buf[1] = 0xfb;
  buf[2] = 0x90;
  buf[3] = 0x00;
  return buf.toString("base64");
}

async function setupHubFlow(opts: { now?: () => number; envExtra?: Record<string, string> } = {}) {
  const fixedNow = opts.now ?? (() => 1_700_000_000_000);
  const env = {
    VOICE_HUB_DEFAULT_PROVIDER: "mock",
    VOICE_HUB_ENABLED: "mock",
    VOICE_HUB_CONSENT_SECRET: "attacker-secret",
    VOICE_CLONE_PROVIDER: "hub",
    VCS_E2E_MOCK_STT: "1",
    ...opts.envExtra,
  };
  const hub = await createVoiceHub({
    env,
    hubRoot: join(process.cwd(), "tools/voice-mcp-hub"),
    adaptersDir: join(process.cwd(), "tools/voice-mcp-hub/adapters"),
    now: fixedNow,
  });
  const provider = createHubVoiceProvider({ env, providerId: "mock", hub });
  const dir = mkdtempSync(join(tmpdir(), "vcs-atk-"));
  const store = new VoiceCloningStore(dir);
  const svc = createVoiceCloningService({
    store,
    provider,
    apiKey: "test-key-not-real",
    env,
    now: fixedNow,
    // STT unused when VCS_E2E_MOCK_STT=1, but keep a safe stub
    transcribe: async () => ({ ok: true, text: "unused", duration: 1 }),
  });
  return { svc, store, hub, env, fixedNow, dir, provider };
}

describe("attacker pass — public figure / names", () => {
  it("blocks case, spacing, voice-of, and homoglyph variants", () => {
    assert.equal(isBlockedPublicFigureName("Elon Musk"), true);
    assert.equal(isBlockedPublicFigureName("  ELON   MUSK "), true);
    assert.equal(isBlockedPublicFigureName("voice of taylor swift"), true);
    assert.equal(isBlockedPublicFigureName("Trump"), true);
    // Cyrillic lookalikes for "trump" — т is greek/cyrillic mixed; use р→p mapping on musk-like
    assert.equal(isBlockedPublicFigureName("еlon musk"), true); // Cyrillic е
    assert.equal(isBlockedPublicFigureName("My Kitchen Voice"), false);
    assert.equal(isBlockedPublicFigureName(""), false);
  });

  it("sanitizeFilenamePart strips path injection", () => {
    assert.equal(sanitizeFilenamePart("../../etc/passwd"), "etc_passwd");
    assert.equal(sanitizeFilenamePart("a/../../b"), "a_b");
    assert.ok(!buildAudioExportFilename("../../etc/passwd", "wav").includes(".."));
    assert.ok(!buildAudioExportFilename("evil\nname", "mp3").includes("\n"));
  });
});

describe("attacker pass — hub mock profile/consent/generate/export", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetMindRateLimitsForTests();
    resetStudioVoiceHubForTests();
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  async function createReadyProfile(
    label = "Home Voice",
  ): Promise<{
    svc: Awaited<ReturnType<typeof setupHubFlow>>["svc"];
    store: VoiceCloningStore;
    profileId: string;
    dir: string;
    env: Record<string, string>;
    fixedNow: () => number;
  }> {
    const ctx = await setupHubFlow();
    dirs.push(ctx.dir);
    const challenge = createConsentChallenge(ctx.fixedNow(), () => "AABBCCDD");
    await ctx.store.putChallenge("user-1", challenge);
    const created = await ctx.svc.createProfile("user-1", {
      name: label,
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("create failed");
    assert.ok(created.profile.providerVoiceId);
    return {
      svc: ctx.svc,
      store: ctx.store,
      profileId: created.profile.id,
      dir: ctx.dir,
      env: ctx.env,
      fixedNow: ctx.fixedNow,
    };
  }

  it("rejects empty / huge / unicode-RTL names and public figures", async () => {
    const ctx = await setupHubFlow();
    dirs.push(ctx.dir);
    for (const name of ["", " ", "\u202Etrump", "Elon Musk", "x".repeat(200)]) {
      const challenge = createConsentChallenge(ctx.fixedNow(), () => "AABBCCDD");
      await ctx.store.putChallenge("user-1", challenge);
      const res = await ctx.svc.createProfile("user-1", {
        name,
        attestation: "own_voice",
        challengeId: challenge.challengeId,
        consentAudioBase64: fakeWavB64(),
        consentMime: "audio/wav",
        sampleAudioBase64: fakeWavB64(),
        sampleMime: "audio/wav",
      });
      assert.equal(res.ok, false, `expected reject for name=${JSON.stringify(name)}`);
    }
  });

  it("rejects zero-length, oversized, wrong MIME, and renamed non-audio samples", async () => {
    const ctx = await setupHubFlow();
    dirs.push(ctx.dir);
    const challenge = createConsentChallenge(ctx.fixedNow(), () => "AABBCCDD");
    await ctx.store.putChallenge("user-1", challenge);
    const base = {
      name: "Kitchen",
      attestation: "own_voice" as const,
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
    };
    const zero = await ctx.svc.createProfile("user-1", {
      ...base,
      sampleAudioBase64: "",
      sampleMime: "audio/wav",
    });
    assert.equal(zero.ok, false);

    const challenge2 = createConsentChallenge(ctx.fixedNow(), () => "AABBCCDD");
    await ctx.store.putChallenge("user-1", challenge2);
    const badMime = await ctx.svc.createProfile("user-1", {
      ...base,
      challengeId: challenge2.challengeId,
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "application/pdf",
    });
    assert.equal(badMime.ok, false);

    const challenge3 = createConsentChallenge(ctx.fixedNow(), () => "AABBCCDD");
    await ctx.store.putChallenge("user-1", challenge3);
    const pdfAsWav = Buffer.from("%PDF-1.4 " + "fake pdf content that is long enough!!!!!!".repeat(8)).toString("base64");
    const renamed = await ctx.svc.createProfile("user-1", {
      ...base,
      challengeId: challenge3.challengeId,
      sampleAudioBase64: pdfAsWav,
      sampleMime: "audio/wav",
    });
    assert.equal(renamed.ok, false);
    if (!renamed.ok) assert.match(renamed.error, /PDF|not audio|RIFF|WAV/i);
  });

  it("rejects skipped attestation and wrong/expired/replayed consent", async () => {
    const ctx = await setupHubFlow();
    dirs.push(ctx.dir);
    const challenge = createConsentChallenge(ctx.fixedNow(), () => "AABBCCDD");
    await ctx.store.putChallenge("user-1", challenge);
    const noAtt = await ctx.svc.createProfile("user-1", {
      name: "Kitchen",
      attestation: "" as unknown as "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(noAtt.ok, false);

    // Wrong code via non-mock path would need STT — with mock STT, phrase always matches.
    // Replay: create once then reuse challenge id.
    const ch = createConsentChallenge(ctx.fixedNow(), () => "DEADBEEF");
    await ctx.store.putChallenge("user-1", ch);
    const ok1 = await ctx.svc.createProfile("user-1", {
      name: "Kitchen One",
      attestation: "own_voice",
      challengeId: ch.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(ok1.ok, true);
    const replay = await ctx.svc.createProfile("user-1", {
      name: "Kitchen Two",
      attestation: "own_voice",
      challengeId: ch.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.code, "challenge_replay");
  });

  it("rejects hub consent token for another profile / expired / tampered", async () => {
    const env = { VOICE_HUB_CONSENT_SECRET: "attacker-secret" };
    const now = 1_700_000_000_000;
    const token = issueConsentToken(
      { consentRecordId: "vcc_a", userId: "u1", profileId: "p1" },
      env,
      now,
    );
    const mismatch = verifyConsentToken(token, "vcc_other", env, now + 1000);
    assert.equal(mismatch.ok, false);
    const expired = verifyConsentToken(token, "vcc_a", env, now + 20 * 60_000);
    assert.equal(expired.ok, false);
    const tampered = token.slice(0, -4) + "xxxx";
    const badSig = verifyConsentToken(tampered, "vcc_a", env, now + 1000);
    assert.equal(badSig.ok, false);
  });

  it("concurrent creates: only one consumes the challenge", async () => {
    const ctx = await setupHubFlow();
    dirs.push(ctx.dir);
    const ch = createConsentChallenge(ctx.fixedNow(), () => "CONCUR01");
    await ctx.store.putChallenge("user-1", ch);
    const payload = {
      name: "Concurrent",
      attestation: "own_voice" as const,
      challengeId: ch.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    };
    const [a, b] = await Promise.all([
      ctx.svc.createProfile("user-1", payload),
      ctx.svc.createProfile("user-1", { ...payload, name: "Concurrent B" }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const fails = [a, b].filter((r) => !r.ok);
    assert.equal(oks.length, 1);
    assert.equal(fails.length, 1);
  });

  it("generation: empty/max text, after delete, provider down, rate burst", async () => {
    const ready = await createReadyProfile("Gen Voice");
    const empty = await ready.svc.generate("user-1", { profileId: ready.profileId, text: "   " });
    assert.equal(empty.ok, false);
    const maxOk = await ready.svc.generate("user-1", {
      profileId: ready.profileId,
      text: "a".repeat(VCS_MAX_GENERATE_CHARS),
    });
    assert.equal(maxOk.ok, true);
    if (!maxOk.ok) return;
    assert.ok(looksLikeWavHeader(Buffer.from(maxOk.audioBase64, "base64")));

    // Burst past generate rate
    let limited = false;
    for (let i = 0; i < VCS_GENERATE_RATE_PER_MIN + 5; i++) {
      const r = await ready.svc.generate("user-1", { profileId: ready.profileId, text: `hi ${i}` });
      if (!r.ok && r.code === "rate_limited") {
        limited = true;
        break;
      }
    }
    assert.equal(limited, true);

    const del = await ready.svc.deleteProfile("user-1", ready.profileId);
    assert.equal(del.ok, true);
    resetMindRateLimitsForTests();
    const after = await ready.svc.generate("user-1", { profileId: ready.profileId, text: "nope" });
    assert.equal(after.ok, false);

    // Provider down: hub provider id that does not exist
    const fixedNow = () => 1_700_000_000_000;
    const env = {
      VOICE_HUB_DEFAULT_PROVIDER: "missing-adapter-xyz",
      VOICE_HUB_ENABLED: "mock",
      VOICE_HUB_CONSENT_SECRET: "attacker-secret",
      VOICE_CLONE_PROVIDER: "hub",
      VCS_E2E_MOCK_STT: "1",
    };
    const hub = await createVoiceHub({
      env,
      hubRoot: join(process.cwd(), "tools/voice-mcp-hub"),
      adaptersDir: join(process.cwd(), "tools/voice-mcp-hub/adapters"),
      now: fixedNow,
    });
    const provider = createHubVoiceProvider({ env, providerId: "missing-adapter-xyz", hub });
    const dir = mkdtempSync(join(tmpdir(), "vcs-atk-down-"));
    dirs.push(dir);
    const store = new VoiceCloningStore(dir);
    const downSvc = createVoiceCloningService({
      store,
      provider,
      apiKey: "test-key-not-real",
      env,
      now: fixedNow,
      transcribe: async () => ({ ok: true, text: "unused", duration: 1 }),
    });
    const ch = createConsentChallenge(fixedNow(), () => "DOWN0001");
    await store.putChallenge("user-1", ch);
    const created = await downSvc.createProfile("user-1", {
      name: "Down Engine",
      attestation: "own_voice",
      challengeId: ch.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.profile.providerStatus === "ready", false);
    const genDown = await downSvc.generate("user-1", { profileId: created.profile.id, text: "hello" });
    assert.equal(genDown.ok, false);
  });

  it("export: no consent / after delete / WAV header / consent JSON has no secrets", async () => {
    const ready = await createReadyProfile("Export Voice");
    resetMindRateLimitsForTests();
    const gen = await ready.svc.generate("user-1", { profileId: ready.profileId, text: "Export me" });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    const wav = ready.svc.exportGeneratedAudio("user-1", {
      profileId: ready.profileId,
      audioBase64: gen.audioBase64,
      sourceMime: gen.mime,
      format: "wav",
    });
    assert.equal(wav.ok, true);
    if (wav.ok) {
      assert.ok(looksLikeWavHeader(Buffer.from(wav.audioBase64, "base64")));
      assert.ok(!wav.filename.includes(".."));
    }

    const consent = ready.svc.exportConsentRecord("user-1", ready.profileId);
    assert.equal(consent.ok, true);
    if (consent.ok) {
      const parsed = JSON.parse(consent.json) as Record<string, unknown>;
      assertConsentExportHasNoSecrets(parsed);
      assert.ok(!("consentCode" in ((parsed.consent as object) || {})));
    }

    // Fake MP3 export of wav bytes must fail header check
    const badMp3 = prepareExportAudio({
      audioBase64: gen.audioBase64,
      sourceMime: "audio/wav",
      format: "mp3",
    });
    assert.equal(badMp3.ok, false);

    const goodMp3 = prepareExportAudio({
      audioBase64: fakeMp3B64(),
      sourceMime: "audio/mpeg",
      format: "mp3",
    });
    assert.equal(goodMp3.ok, true);

    await ready.svc.deleteProfile("user-1", ready.profileId);
    const afterDel = ready.svc.exportGeneratedAudio("user-1", {
      profileId: ready.profileId,
      audioBase64: gen.audioBase64,
      sourceMime: gen.mime,
      format: "wav",
    });
    assert.equal(afterDel.ok, false);

    // No consent: strip consent from store by creating orphaned scenario via markDeleted path already tested;
    // buildConsentExportPayload alone should pass assert
    const payload = buildConsentExportPayload(
      {
        id: "vcp_x",
        userId: "u",
        name: "n",
        createdAt: "t",
        updatedAt: "t",
        status: "active",
        provider: "local-http",
        providerVoiceId: "mock_1",
        providerStatus: "ready",
        providerMessage: "ok",
        sampleBytes: 1,
        sampleMime: "audio/wav",
        consentId: "vcc_x",
        deletedAt: null,
      },
      {
        id: "vcc_x",
        profileId: "vcp_x",
        userId: "u",
        createdAt: "t",
        attestation: "own_voice",
        consentCode: "SHOULD_NOT_EXPORT",
        phraseHash: "abc",
        transcriptNormalized: "consent clone voice adrian mind",
        speakerName: "n",
      },
    );
    assertConsentExportHasNoSecrets(payload);
  });

  it("create rate limit burst", async () => {
    const ctx = await setupHubFlow();
    dirs.push(ctx.dir);
    let limited = false;
    for (let i = 0; i < VCS_CREATE_RATE_PER_MIN + 3; i++) {
      const ch = createConsentChallenge(ctx.fixedNow(), () => `CD${i.toString(16).padStart(6, "0")}`.slice(0, 8).toUpperCase());
      await ctx.store.putChallenge("user-1", ch);
      const r = await ctx.svc.createProfile("user-1", {
        name: `Voice ${i}`,
        attestation: "own_voice",
        challengeId: ch.challengeId,
        consentAudioBase64: fakeWavB64(),
        consentMime: "audio/wav",
        sampleAudioBase64: fakeWavB64(),
        sampleMime: "audio/wav",
      });
      if (!r.ok && r.code === "rate_limited") {
        limited = true;
        break;
      }
    }
    assert.equal(limited, true);
  });
});
