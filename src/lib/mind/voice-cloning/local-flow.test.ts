/**
 * Full Studio flow THROUGH the Voice Connection Hub (mock adapter).
 * Label: MOCK-VERIFIED — not a real voice clone.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { resetMindRateLimitsForTests } from "../limits.ts";
import { createConsentChallenge } from "./consent.ts";
import { createHubVoiceProvider } from "./hub-provider.ts";
import { createVoiceHub } from "../../../../tools/voice-mcp-hub/src/hub.ts";
import { resetStudioVoiceHubForTests } from "./hub-client.ts";
import { createVoiceCloningService } from "./service.ts";
import { VoiceCloningStore } from "./store.ts";

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


describe("MOCK-VERIFIED studio→hub→mock flow (not a real clone)", () => {
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

  it("consent → profile → hub create → synth → export → delete → generate-after-delete fails", async () => {
    const env = {
      VOICE_HUB_DEFAULT_PROVIDER: "mock",
      VOICE_HUB_ENABLED: "mock",
      VOICE_HUB_CONSENT_SECRET: "flow-secret",
      VOICE_CLONE_PROVIDER: "hub",
    };
    const fixedNow = () => 1_700_000_000_000;
    const hub = await createVoiceHub({
      env,
      hubRoot: join(process.cwd(), "tools/voice-mcp-hub"),
      adaptersDir: join(process.cwd(), "tools/voice-mcp-hub/adapters"),
      now: fixedNow,
    });
    const provider = createHubVoiceProvider({ env, providerId: "mock", hub });
    const dir = mkdtempSync(join(tmpdir(), "vcs-hub-flow-"));
    dirs.push(dir);
    const store = new VoiceCloningStore(dir);
    const svc = createVoiceCloningService({
      store,
      provider,
      apiKey: "xai-test-key-not-real",
      env,
      transcribe: async () => ({
        ok: true,
        text: "I consent to clone my voice for Adrian's Mind. Confirmation code AABBCCDD.",
        duration: 1,
      }),
      now: fixedNow,
    });

    const st = await svc.getStatus();
    assert.equal(st.canClone, true);

    const challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD");
    await store.putChallenge("user-1", challenge);
    const created = await svc.createProfile("user-1", {
      name: "Hub Mock Voice",
      attestation: "own_voice",
      challengeId: challenge.challengeId,
      consentAudioBase64: fakeWavB64(),
      consentMime: "audio/wav",
      sampleAudioBase64: fakeWavB64(),
      sampleMime: "audio/wav",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.ok(created.profile.providerVoiceId);

    const gen = await svc.generate("user-1", { profileId: created.profile.id, text: "Hello from Adrian's Mind." });
    assert.equal(gen.ok, true);
    if (!gen.ok) return;

    const exp = svc.exportGeneratedAudio("user-1", {
      profileId: created.profile.id,
      audioBase64: gen.audioBase64,
      sourceMime: gen.mime,
      format: "wav",
    });
    assert.equal(exp.ok, true);

    const del = await svc.deleteProfile("user-1", created.profile.id);
    assert.equal(del.ok, true);

    const after = await svc.generate("user-1", { profileId: created.profile.id, text: "Nope" });
    assert.equal(after.ok, false);
    if (!after.ok) assert.equal(after.code, "not_found");
  });
});
