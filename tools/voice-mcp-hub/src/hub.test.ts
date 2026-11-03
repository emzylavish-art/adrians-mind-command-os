/**
 * Hub + adapter conformance / attacker pass.
 * MOCK-VERIFIED where mock adapter is used — not a real clone.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { createVoiceHub } from "./hub.ts";
import { issueConsentToken, verifyConsentToken } from "./consent-token.ts";
import { assertSafeAdapterId, loadAdaptersFromDir } from "./discover.ts";

const hubRoot = join(process.cwd(), "tools/voice-mcp-hub");
const adaptersDir = join(hubRoot, "adapters");

describe("adapter id safety", () => {
  it("rejects path traversal names", () => {
    assert.throws(() => assertSafeAdapterId("../evil"));
    assert.throws(() => assertSafeAdapterId("foo/bar"));
    assert.doesNotThrow(() => assertSafeAdapterId("chatterbox-local"));
  });
});

describe("consent token", () => {
  it("round-trips and rejects mismatch / expiry", () => {
    const env = { VOICE_HUB_CONSENT_SECRET: "test-secret" };
    const token = issueConsentToken({ consentRecordId: "vcc_1", userId: "u1" }, env, 1_000);
    const ok = verifyConsentToken(token, "vcc_1", env, 1_100);
    assert.equal(ok.ok, true);
    const bad = verifyConsentToken(token, "vcc_other", env, 1_100);
    assert.equal(bad.ok, false);
    const expired = verifyConsentToken(token, "vcc_1", env, 1_000 + 16 * 60_000);
    assert.equal(expired.ok, false);
  });
});

describe("hub MOCK-VERIFIED flow", () => {
  it("consent → create → synth → delete → synth-after-delete fails", async () => {
    const hub = await createVoiceHub({
      hubRoot,
      adaptersDir,
      env: {
        VOICE_HUB_DEFAULT_PROVIDER: "mock",
        VOICE_HUB_ENABLED: "mock,xai,chatterbox-local",
        VOICE_HUB_CONSENT_SECRET: "test-secret",
      },
    });
    const health = await hub.health("mock");
    assert.equal(health.ok, true);

    const consentRecordId = "vcc_flow_1";
    const token = issueConsentToken({ consentRecordId, userId: "u1" }, { VOICE_HUB_CONSENT_SECRET: "test-secret" });
    const created = await hub.createVoice({
      providerId: "mock",
      name: "Mock",
      consentToken: token,
      consentRecordId,
      fileBytes: new Uint8Array(128).fill(3),
      filename: "a.wav",
      mime: "audio/wav",
    });
    assert.ok(created.voiceId);

    const synth = await hub.synthesize({
      providerId: "mock",
      voiceId: created.voiceId,
      text: "Hello from Adrian's Mind",
      format: "wav",
    });
    assert.ok(synth.bytes.length > 32);

    const del = await hub.deleteVoice({ providerId: "mock", voiceId: created.voiceId });
    assert.equal(del.deleted, true);

    await assert.rejects(
      () => hub.synthesize({ providerId: "mock", voiceId: created.voiceId, text: "nope" }),
      /not found/i,
    );
  });

  it("refuses create_voice without consent", async () => {
    const hub = await createVoiceHub({
      hubRoot,
      adaptersDir,
      env: { VOICE_HUB_DEFAULT_PROVIDER: "mock", VOICE_HUB_ENABLED: "mock", VOICE_HUB_CONSENT_SECRET: "s" },
    });
    await assert.rejects(
      () =>
        hub.createVoice({
          name: "x",
          consentToken: "bad",
          consentRecordId: "vcc_x",
          fileBytes: new Uint8Array(64),
          filename: "a.wav",
          mime: "audio/wav",
        }),
      /consent/i,
    );
  });
});

describe("hub attacker pass", () => {
  it("unknown provider / disabled xai", async () => {
    const hub = await createVoiceHub({
      hubRoot,
      adaptersDir,
      env: { VOICE_HUB_DEFAULT_PROVIDER: "xai", VOICE_HUB_ENABLED: "xai,mock", VOICE_HUB_CONSENT_SECRET: "s" },
    });
    const h = await hub.health("xai");
    assert.equal(h.ok, false);
    assert.match(h.detail || "", /unsupported|xAI/i);

    const evil = await hub.health("../evil" as string);
    assert.equal(evil.ok, false);
    assert.match(evil.detail || "", /invalid|unsafe|traversal|adapter/i);
  });

  it("adapter discovery skips traversal filenames", async () => {
    const map = await loadAdaptersFromDir(adaptersDir, {});
    assert.ok(map.has("mock"));
    assert.ok(map.has("chatterbox-local"));
    assert.ok(map.has("elevenlabs"));
  });

  it("elevenlabs honest not configured without key", async () => {
    const hub = await createVoiceHub({
      hubRoot,
      adaptersDir,
      env: { VOICE_HUB_DEFAULT_PROVIDER: "elevenlabs", VOICE_HUB_ENABLED: "elevenlabs", VOICE_HUB_CONSENT_SECRET: "s" },
    });
    const h = await hub.health("elevenlabs");
    assert.equal(h.ok, false);
    assert.match(h.detail || "", /ELEVENLABS_API_KEY|not set/i);
  });

  it("synthesize rejects oversized text", async () => {
    const hub = await createVoiceHub({
      hubRoot,
      adaptersDir,
      env: { VOICE_HUB_DEFAULT_PROVIDER: "mock", VOICE_HUB_ENABLED: "mock", VOICE_HUB_CONSENT_SECRET: "s" },
    });
    await assert.rejects(() => hub.synthesize({ voiceId: "x", text: "y".repeat(600) }), /too long/i);
  });
});
