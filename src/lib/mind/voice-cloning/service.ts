/**
 * Voice Cloning Studio orchestration.
 * Reuses resolveVoiceApiKey + transcribeWavBytes from existing voice layer (import only).
 */
import { randomBytes } from "node:crypto";
import { allowMindRequest } from "../limits.ts";
import { resolveVoiceApiKey } from "../voice/keys.ts";
import { transcribeWavBytes } from "../voice/stt.ts";
import {
  createConsentChallenge,
  hashConsentPhrase,
  verifyConsentTranscript,
} from "./consent.ts";
import {
  VCS_CREATE_RATE_PER_MIN,
  VCS_DELETE_RATE_PER_MIN,
  VCS_GENERATE_RATE_PER_MIN,
  VCS_MAX_PROFILES_PER_USER,
} from "./limits.ts";
import {
  buildAudioExportFilename,
  buildConsentExportFilename,
  buildConsentExportPayload,
  prepareExportAudio,
} from "./export.ts";
import { resolveVoiceCloneProvider, type VoiceCloneProvider } from "./provider.ts";
import { issueConsentToken } from "./hub-client.ts";
import { getVoiceCloningStore, type VoiceCloningStore } from "./store.ts";
import type {
  ConsentAttestation,
  ConsentChallenge,
  ConsentRecord,
  DeleteResult,
  ExportAudioFormat,
  ExportAudioResult,
  ExportConsentResult,
  GenerateResult,
  ProviderStatusReport,
  VoiceProfile,
} from "./types.ts";
import {
  decodeAudioBase64,
  validateAttestation,
  validateAudioBase64,
  validateGenerateText,
  validateProfileName,
} from "./validate.ts";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export type VoiceCloningServiceDeps = {
  store?: VoiceCloningStore;
  provider?: VoiceCloneProvider;
  apiKey?: string | undefined;
  /** Inject STT for tests. */
  transcribe?: typeof transcribeWavBytes;
  now?: () => number;
  env?: Record<string, string | undefined>;
};

export function createVoiceCloningService(deps: VoiceCloningServiceDeps = {}) {
  const store = deps.store ?? getVoiceCloningStore();
  const now = deps.now ?? Date.now;
  const transcribe = deps.transcribe ?? transcribeWavBytes;

  function resolveKey(): string | undefined {
    if (deps.apiKey !== undefined) return deps.apiKey;
    return resolveVoiceApiKey(process.env);
  }

  function provider(): VoiceCloneProvider {
    return resolveVoiceCloneProvider({
      override: deps.provider,
      apiKey: resolveKey(),
      env: deps.env,
    });
  }

  return {
    async getStatus(): Promise<ProviderStatusReport> {
      return provider().status();
    },

    async createChallenge(userId: string): Promise<ConsentChallenge> {
      if (!allowMindRequest("vcs_challenge", userId, 30)) {
        throw Object.assign(new Error("Too many consent challenges. Wait a minute."), { code: "rate_limited" });
      }
      const challenge = createConsentChallenge(now());
      await store.putChallenge(userId, challenge);
      return challenge;
    },

    listProfiles(userId: string): VoiceProfile[] {
      return store.listProfiles(userId);
    },

    async createProfile(userId: string, input: {
      name: unknown;
      attestation: unknown;
      challengeId: unknown;
      consentAudioBase64: unknown;
      consentMime: unknown;
      sampleAudioBase64: unknown;
      sampleMime: unknown;
    }): Promise<{ ok: true; profile: VoiceProfile } | { ok: false; error: string; code?: string }> {
      if (!allowMindRequest("vcs_create", userId, VCS_CREATE_RATE_PER_MIN)) {
        return { ok: false, error: "Too many profile creates. Wait a minute.", code: "rate_limited" };
      }
      const nameV = validateProfileName(input.name);
      if (!nameV.ok) return nameV;
      const attV = validateAttestation(input.attestation);
      if (!attV.ok) return attV;
      if (typeof input.challengeId !== "string" || !input.challengeId.trim()) {
        return { ok: false, error: "Missing consent challenge. Request a new consent phrase.", code: "missing_challenge" };
      }
      const consentAudio = validateAudioBase64({
        audioBase64: input.consentAudioBase64,
        mime: input.consentMime,
        label: "Consent recording",
      });
      if (!consentAudio.ok) return consentAudio;
      const sampleAudio = validateAudioBase64({
        audioBase64: input.sampleAudioBase64,
        mime: input.sampleMime,
        label: "Voice sample",
      });
      if (!sampleAudio.ok) return sampleAudio;
      if (store.countActiveProfiles(userId) >= VCS_MAX_PROFILES_PER_USER) {
        return { ok: false, error: `Profile limit reached (${VCS_MAX_PROFILES_PER_USER}). Delete one first.`, code: "limit" };
      }

      // Consume challenge once — blocks replay / double-submit of same code.
      const challenge = await store.takeChallenge(userId, input.challengeId.trim(), now());
      if (!challenge) {
        return {
          ok: false,
          error: "Consent challenge is missing, expired, or already used. Request a new phrase.",
          code: "challenge_replay",
        };
      }

      const apiKey = resolveKey();
      if (!apiKey) {
        return {
          ok: false,
          error: "No speech key is configured. Consent could not be verified by STT. Nothing was created.",
          code: "not_configured",
        };
      }

      const stt = await transcribe({
        bytes: decodeAudioBase64(consentAudio.audioBase64),
        apiKey,
        mime: consentAudio.mime,
        filename: "consent.wav",
      });
      if (!stt.ok) {
        return { ok: false, error: stt.error, code: "stt_failed" };
      }
      const verified = verifyConsentTranscript({
        transcript: stt.text,
        expectedCode: challenge.code,
        expectedPhrase: challenge.phrase,
      });
      if (!verified.ok) return { ok: false, error: verified.error, code: "consent_mismatch" };

      const profileId = newId("vcp");
      const consentId = newId("vcc");
      const createdAt = new Date(now()).toISOString();

      const activeProvider = provider();
      const consentToken = issueConsentToken(
        { consentRecordId: consentId, userId, profileId },
        deps.env ?? process.env,
        now(),
      );
      const clone = await activeProvider.createVoice({
        name: nameV.name,
        profileId,
        fileBytes: decodeAudioBase64(sampleAudio.audioBase64),
        filename: "sample.wav",
        mime: sampleAudio.mime,
        consentToken,
        consentRecordId: consentId,
      });

      let providerVoiceId: string | null = null;
      let providerStatus: VoiceProfile["providerStatus"] = "not_configured";
      let providerMessage: string;
      let status: VoiceProfile["status"] = "provider_not_configured";

      if (clone.ok) {
        providerVoiceId = clone.voiceId;
        providerStatus = "ready";
        providerMessage = "Custom voice created on xAI.";
        status = "active";
      } else {
        providerMessage = clone.error;
        providerStatus = clone.code === "not_configured" ? "not_configured" : "error";
        status = "provider_not_configured";
      }

      const consent: ConsentRecord = {
        id: consentId,
        profileId,
        userId,
        createdAt,
        attestation: attV.attestation as ConsentAttestation,
        consentCode: challenge.code,
        phraseHash: hashConsentPhrase(challenge.phrase),
        transcriptNormalized: stt.text.toLowerCase(),
        speakerName: nameV.name,
      };

      const profile: VoiceProfile = {
        id: profileId,
        userId,
        name: nameV.name,
        createdAt,
        updatedAt: createdAt,
        status,
        provider: activeProvider.id,
        providerVoiceId,
        providerStatus,
        providerMessage,
        sampleBytes: sampleAudio.decodedBytes,
        sampleMime: sampleAudio.mime,
        consentId,
        deletedAt: null,
      };

      await store.saveProfile({
        profile,
        consent,
        sampleBase64: sampleAudio.audioBase64,
      });

      return { ok: true, profile };
    },

    async generate(userId: string, input: { profileId: unknown; text: unknown }): Promise<GenerateResult> {
      if (!allowMindRequest("vcs_generate", userId, VCS_GENERATE_RATE_PER_MIN)) {
        return { ok: false, error: "Too many generate requests. Wait a minute.", code: "rate_limited" };
      }
      if (typeof input.profileId !== "string" || !input.profileId.trim()) {
        return { ok: false, error: "Missing voice profile.", code: "missing_profile" };
      }
      const textV = validateGenerateText(input.text);
      if (!textV.ok) return textV;

      const profile = store.getProfile(userId, input.profileId.trim());
      if (!profile) {
        return { ok: false, error: "Voice profile not found or was deleted. Nothing was generated.", code: "not_found" };
      }
      // Verified consent required (consent record must still exist).
      const consent = store.getConsent(profile.consentId) ?? store.getConsentForProfile(profile.id);
      if (!consent) {
        return { ok: false, error: "Consent record missing. Generate is blocked.", code: "missing_consent" };
      }
      if (!profile.providerVoiceId || profile.providerStatus !== "ready") {
        return {
          ok: false,
          error: profile.providerMessage || "Provider not configured. Cloning/generate is unavailable for this team.",
          code: "not_configured",
        };
      }

      const tts = await provider().synthesize({
        text: textV.text,
        voiceId: profile.providerVoiceId,
        format: profile.provider === "local-http" ? "wav" : "mp3",
      });
      if (!tts.ok) return { ok: false, error: tts.error, code: tts.code };
      return {
        ok: true,
        audioBase64: Buffer.from(tts.bytes).toString("base64"),
        mime: tts.mime,
      };
    },

    async deleteProfile(userId: string, profileId: unknown): Promise<DeleteResult> {
      if (!allowMindRequest("vcs_delete", userId, VCS_DELETE_RATE_PER_MIN)) {
        return { ok: false, error: "Too many deletes. Wait a minute.", code: "rate_limited" };
      }
      if (typeof profileId !== "string" || !profileId.trim()) {
        return { ok: false, error: "Missing voice profile.", code: "missing_profile" };
      }
      const id = profileId.trim();
      const existing = store.getProfile(userId, id, true);
      if (!existing) {
        return { ok: false, error: "Voice profile not found.", code: "not_found" };
      }
      if (existing.status === "deleted") {
        return {
          ok: true,
          profileId: id,
          deletedAt: existing.deletedAt || new Date(now()).toISOString(),
          providerDeleted: false,
          verifiable: true,
        };
      }

      let providerDeleted = false;
      if (existing.providerVoiceId) {
        const del = await provider().deleteVoice(existing.providerVoiceId);
        providerDeleted = del.ok ? del.deleted : false;
      }

      const marked = await store.markDeleted(userId, id, now());
      if (!marked || marked.status !== "deleted") {
        return { ok: false, error: "Delete did not complete.", code: "delete_failed" };
      }
      // Verifiable: profile gone from active list + consent removed + sample removed.
      const stillActive = store.getProfile(userId, id);
      const consentGone = !store.getConsentForProfile(id);
      const sampleGone = store.readSampleBase64(id) === null;
      if (stillActive || !consentGone || !sampleGone) {
        return { ok: false, error: "Delete could not be verified.", code: "delete_unverified" };
      }
      return {
        ok: true,
        profileId: id,
        deletedAt: marked.deletedAt!,
        providerDeleted,
        verifiable: true,
      };
    },

    /**
     * Export last-generated audio for a live profile with verified consent.
     * Caller supplies the generated bytes from the current session (server does not retain TTS cache long-term).
     */
    exportGeneratedAudio(userId: string, input: {
      profileId: unknown;
      audioBase64: unknown;
      sourceMime: unknown;
      format: unknown;
    }): ExportAudioResult {
      if (typeof input.profileId !== "string" || !input.profileId.trim()) {
        return { ok: false, error: "Missing voice profile.", code: "missing_profile" };
      }
      const profile = store.getProfile(userId, input.profileId.trim(), true);
      if (!profile || profile.status === "deleted") {
        return { ok: false, error: "Voice profile was deleted. Export is not allowed.", code: "deleted" };
      }
      const consent = store.getConsent(profile.consentId) ?? store.getConsentForProfile(profile.id);
      if (!consent) {
        return { ok: false, error: "Verified consent is required to export.", code: "missing_consent" };
      }
      if (typeof input.audioBase64 !== "string" || !input.audioBase64.trim()) {
        return { ok: false, error: "No generated audio to export. Generate first.", code: "no_audio" };
      }
      const format = input.format === "wav" ? "wav" : input.format === "mp3" ? "mp3" : null;
      if (!format) {
        return { ok: false, error: "Export format must be mp3 or wav.", code: "bad_format" };
      }
      const prepared = prepareExportAudio({
        audioBase64: input.audioBase64.replace(/\s+/g, ""),
        sourceMime: typeof input.sourceMime === "string" ? input.sourceMime : "audio/mpeg",
        format: format as ExportAudioFormat,
      });
      if (!prepared.ok) return prepared;
      return {
        ok: true,
        filename: buildAudioExportFilename(profile.name, format as ExportAudioFormat, new Date(now())),
        mime: prepared.mime,
        audioBase64: prepared.audioBase64,
        format: format as ExportAudioFormat,
        profileId: profile.id,
        profileName: profile.name,
      };
    },

    exportConsentRecord(userId: string, profileId: unknown): ExportConsentResult {
      if (typeof profileId !== "string" || !profileId.trim()) {
        return { ok: false, error: "Missing voice profile.", code: "missing_profile" };
      }
      const profile = store.getProfile(userId, profileId.trim(), true);
      if (!profile || profile.status === "deleted") {
        return { ok: false, error: "Voice profile was deleted. Consent export is not allowed.", code: "deleted" };
      }
      const consent = store.getConsent(profile.consentId) ?? store.getConsentForProfile(profile.id);
      if (!consent) {
        return { ok: false, error: "Verified consent is required to export.", code: "missing_consent" };
      }
      const payload = buildConsentExportPayload(profile, consent);
      return {
        ok: true,
        filename: buildConsentExportFilename(profile.name, new Date(now())),
        mime: "application/json",
        json: JSON.stringify(payload, null, 2),
        profileId: profile.id,
      };
    },
  };
}

export type VoiceCloningService = ReturnType<typeof createVoiceCloningService>;
