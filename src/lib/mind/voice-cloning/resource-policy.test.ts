import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createVoiceCloningService, voiceCloneIsLocalFree } from "./service.ts";
import { createConsentChallenge } from "./consent.ts";
import { VoiceCloningStore } from "./store.ts";
import type { VoiceCloneProvider } from "./provider-interface.ts";
import { resetMindRateLimitsForTests } from "../limits.ts";

function fixtureWav() {
  const b = Buffer.alloc(300, 1); b.write("RIFF", 0); b.writeUInt32LE(292, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(256, 40); return b.toString("base64");
}
test("AA093 voice cloning authorizes each paid stage after validation and never blocks revocation on budget", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "c1-vcs-budget-"));
  try {
    const store = new VoiceCloningStore(directory);
    let deny = true, transcriptions = 0, clones = 0, speeches = 0, deletions = 0;
    const attempted: string[] = [], settlements: boolean[] = [];
    const provider: VoiceCloneProvider = { id: "local-http", status: async () => { throw new Error("No status probe in this fixture"); }, createVoice: async () => { clones++; return { ok: true, voiceId: "fixture-voice" }; }, synthesize: async () => { speeches++; return { ok: true, bytes: new Uint8Array([1]), mime: "audio/wav" }; }, deleteVoice: async () => { deletions++; return { ok: true, deleted: true }; } };
    const service = createVoiceCloningService({ store, provider, apiKey: "fixture-only", now: () => 1_700_000_000_000, env: {},
      authorize: async ({ operation, free }) => { attempted.push(operation); assert.equal(free, operation !== "consent-stt"); if (deny) throw new Error("Fixture budget refused dispatch."); return async (ok) => { settlements.push(ok); }; },
      transcribe: async () => { transcriptions++; return { ok: true, text: "I consent to clone my voice for Adrian's Mind. Confirmation code AABBCCDD.", duration: 1 }; },
    });
    const input = { name: "Fixture Voice", attestation: "own_voice", challengeId: "", consentAudioBase64: fixtureWav(), consentMime: "audio/wav", sampleAudioBase64: fixtureWav(), sampleMime: "audio/wav" };
    const invalid = await service.createProfile("voice-owner", { ...input, name: "" }); assert.equal(invalid.ok, false); assert.equal(attempted.length, 0);
    let challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD"); await store.putChallenge("voice-owner", challenge);
    const denied = await service.createProfile("voice-owner", { ...input, challengeId: challenge.challengeId }); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.code, "resource_policy"); assert.equal(transcriptions, 0); assert.equal(clones, 0);
    deny = false; resetMindRateLimitsForTests();
    challenge = createConsentChallenge(1_700_000_000_000, () => "AABBCCDD"); await store.putChallenge("voice-owner", challenge);
    const made = await service.createProfile("voice-owner", { ...input, challengeId: challenge.challengeId }); assert(made.ok); assert.equal(transcriptions, 1); assert.equal(clones, 1); assert.deepEqual(settlements, [true, true]);
    deny = true;
    const speech = await service.generate("voice-owner", { profileId: made.profile.id, text: "Hello" }); assert.equal(speech.ok, false); assert.equal(speeches, 0);
    const callsBeforeDelete = attempted.length;
    const deleted = await service.deleteProfile("voice-owner", made.profile.id); assert.equal(deleted.ok, true); assert.equal(deletions, 1); assert.equal(attempted.length, callsBeforeDelete);
  } finally { resetMindRateLimitsForTests(); await rm(directory, { recursive: true, force: true }); }
});
test("AA093 a provider label or remote URL does not establish free local execution", () => {
  assert(voiceCloneIsLocalFree("local-http", {}));
  assert(!voiceCloneIsLocalFree("local-http", { VOICE_CLONE_ALLOW_REMOTE: "1", VOICE_CLONE_LOCAL_URL: "https://remote.example" }));
  assert(!voiceCloneIsLocalFree("hub", { VOICE_CLONE_LOCAL_URL: "http://localhost:7860" }));
});
