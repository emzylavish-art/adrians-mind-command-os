/**
 * Voice Cloning Studio orchestration.
 * Reuses resolveVoiceApiKey + transcribeWavBytes from existing voice layer (import only).
 */
import { randomBytes } from "node:crypto";
import { allowSharedMindRequest as allowMindRequest } from "../rate-limit.server.ts";
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
  assertConsentExportHasNoSecrets,
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
import { sniffAudioMagic } from "./audio-sniff.ts";
import { resolveVoiceCloneLocalUrlFromEnv } from "./local-url.ts";
import { isLoopbackHostname } from "../voice/ollama-host.ts";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function voiceCloneIsLocalFree(providerId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (providerId !== "local-http") return false;
  const resolved = resolveVoiceCloneLocalUrlFromEnv(env);
  return resolved.ok && isLoopbackHostname(new URL(resolved.base).hostname);
}

export type VoiceCloningServiceDeps = {
  /** Production boundary injected by server.ts; deterministic fixtures may inject a no-network authority. */
  authorize?: (input: { owner: string; provider: string; operation: "consent-stt" | "clone" | "speech"; free: boolean }) => Promise<(ok: boolean) => Promise<void>>;
  store?: VoiceCloningStore;
  provider?: VoiceCloneProvider;
  apiKey?: string | undefined;
  /** Inject STT for tests. */
  transcribe?: typeof transcribeWavBytes;
  now?: () => number;
  env?: Record<string, string | undefined>;
};

export function createVoiceCloningService(deps: VoiceCloningServiceDeps = {}) {
  const store = () => deps.store ?? getVoiceCloningStore();
  const now = deps.now ?? Date.now;
  const transcribe = deps.transcribe ?? transcribeWavBytes;
  async function authorized<T extends { ok: boolean }>(owner: string, providerId: string, operation: "consent-stt" | "clone" | "speech", run: () => Promise<T>): Promise<T | { ok: false; code: string; error: string; dispatched: false }> {
    let settle: ((ok: boolean) => Promise<void>) | undefined;
    try { settle = await deps.authorize?.({ owner, provider: providerId, operation, free: operation !== "consent-stt" && voiceCloneIsLocalFree(providerId, deps.env ?? process.env) }); }
    catch (error) { return { ok: false, code: "resource_policy", dispatched: false, error: error instanceof Error ? error.message : "Resource policy refused this operation. The provider was not contacted." }; }
    try { const result = await run(); await settle?.(result.ok); return result; }
    catch (error) { await settle?.(false); throw error; }
  }

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
      if (!await allowMindRequest("vcs_challenge", userId, 30)) {
        throw Object.assign(new Error("Too many consent challenges. Wait a minute."), { code: "rate_limited" });
      }
      const challenge = createConsentChallenge(now());
      await store().putChallenge(userId, challenge);
      return challenge;
    },

    listProfiles(userId: string): VoiceProfile[] {
      return [...store().listProfiles(userId), ...store().pendingProviderDeletes(userId).map((p) => ({ ...p, providerVoiceId: null }))];
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
      if (!await allowMindRequest("vcs_create", userId, VCS_CREATE_RATE_PER_MIN)) {
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
      const consentBytes = decodeAudioBase64(consentAudio.audioBase64);
      const sampleBytes = decodeAudioBase64(sampleAudio.audioBase64);
      const consentSniff = sniffAudioMagic(consentBytes, consentAudio.mime);
      if (!consentSniff.ok) return { ok: false, error: `Consent recording: ${consentSniff.error}`, code: consentSniff.code };
      const sampleSniff = sniffAudioMagic(sampleBytes, sampleAudio.mime);
      if (!sampleSniff.ok) return { ok: false, error: `Voice sample: ${sampleSniff.error}`, code: sampleSniff.code };
      if (store().countActiveProfiles(userId) >= VCS_MAX_PROFILES_PER_USER) {
        return { ok: false, error: `Profile limit reached (${VCS_MAX_PROFILES_PER_USER}). Delete one first.`, code: "limit" };
      }

      // Consume challenge once — blocks replay / double-submit of same code.
      const challenge = await store().takeChallenge(userId, input.challengeId.trim(), now());
      if (!challenge) {
        return {
          ok: false,
          error: "Consent challenge is missing, expired, or already used. Request a new phrase.",
          code: "challenge_replay",
        };
      }

      const apiKey = resolveKey();
      const e2eMockSttEarly = (deps.env ?? process.env).VCS_E2E_MOCK_STT === "1";
      if (!apiKey && !e2eMockSttEarly) {
        return {
          ok: false,
          error: "No speech key is configured. Consent could not be verified by STT. Nothing was created.",
          code: "not_configured",
        };
      }

      const e2eMockStt = e2eMockSttEarly;
      const stt = e2eMockStt
        ? { ok: true as const, text: challenge.phrase, duration: 1 }
        : await authorized(userId, "xai-stt", "consent-stt", () => transcribe({
            bytes: consentBytes,
            apiKey: apiKey as string,
            mime: consentAudio.mime,
            filename: "consent.wav",
          }));
      if (!stt.ok) {
        return { ok: false, error: stt.error, code: "code" in stt && stt.code === "resource_policy" ? "resource_policy" : "stt_failed" };
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
      const clone = await authorized(userId, activeProvider.id, "clone", () => activeProvider.createVoice({
        name: nameV.name,
        profileId,
        fileBytes: sampleBytes,
        filename: "sample.wav",
        mime: sampleAudio.mime,
        consentToken,
        consentRecordId: consentId,
      }));
      if (!clone.ok && clone.code === "resource_policy") return { ok: false, error: clone.error, code: clone.code };

      let providerVoiceId: string | null = null;
      let providerStatus: VoiceProfile["providerStatus"] = "not_configured";
      let providerMessage: string;
      let status: VoiceProfile["status"] = "provider_not_configured";

      if (clone.ok) {
        providerVoiceId = clone.voiceId;
        providerStatus = "ready";
        providerMessage = "Custom voice created via Voice Connection Hub.";
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

      await store().saveProfile({
        profile,
        consent,
        sampleBase64: sampleAudio.audioBase64,
      });

      return { ok: true, profile };
    },

    async generate(userId: string, input: { profileId: unknown; text: unknown }): Promise<GenerateResult> {
      if (!await allowMindRequest("vcs_generate", userId, VCS_GENERATE_RATE_PER_MIN)) {
        return { ok: false, error: "Too many generate requests. Wait a minute.", code: "rate_limited" };
      }
      if (typeof input.profileId !== "string" || !input.profileId.trim()) {
        return { ok: false, error: "Missing voice profile.", code: "missing_profile" };
      }
      const textV = validateGenerateText(input.text);
      if (!textV.ok) return textV;

      const profile = store().getProfile(userId, input.profileId.trim());
      if (!profile) {
        return { ok: false, error: "Voice profile not found or was deleted. Nothing was generated.", code: "not_found" };
      }
      // Verified consent required (consent record must still exist).
      const consent = store().getConsent(profile.consentId) ?? store().getConsentForProfile(profile.id);
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

      const selectedProvider = provider();
      if (selectedProvider.id !== profile.provider) return { ok: false, code: "provider_changed", error: "Reconnect the voice provider used to create this profile." };
      const voiceId = profile.providerVoiceId;
      const tts = await authorized(userId, selectedProvider.id, "speech", () => selectedProvider.synthesize({
        text: textV.text,
        voiceId,
        format: profile.provider === "local-http" ? "wav" : "mp3",
      }));
      if (!tts.ok) return { ok: false, error: tts.error, code: tts.code };
      return {
        ok: true,
        audioBase64: Buffer.from(tts.bytes).toString("base64"),
        mime: tts.mime,
      };
    },

    async deleteProfile(userId: string, profileId: unknown): Promise<DeleteResult> {
      if (!await allowMindRequest("vcs_delete", userId, VCS_DELETE_RATE_PER_MIN)) {
        return { ok: false, error: "Too many deletes. Wait a minute.", code: "rate_limited" };
      }
      if (typeof profileId !== "string" || !profileId.trim()) {
        return { ok: false, error: "Missing voice profile.", code: "missing_profile" };
      }
      const id = profileId.trim();
      const existing = store().getProfile(userId, id, true);
      if (!existing) {
        return { ok: false, error: "Voice profile not found.", code: "not_found" };
      }
      const marked = await store().markDeleted(userId, id, now());
      if (!marked || marked.status !== "deleted") {
        return { ok: false, error: "Delete did not complete.", code: "delete_failed" };
      }
      // Verifiable: profile gone from active list + consent removed + sample removed.
      const stillActive = store().getProfile(userId, id);
      const consentGone = !store().getConsentForProfile(id);
      const sampleGone = store().readSampleBase64(id) === null;
      if (stillActive || !consentGone || !sampleGone) {
        return { ok: false, error: "Delete could not be verified.", code: "delete_unverified" };
      }
      let providerDeleted = false;
      if (marked.providerVoiceId) {
        const activeProvider = provider();
        if (activeProvider.id === marked.provider) {
          try {
            const result = await activeProvider.deleteVoice(marked.providerVoiceId);
            providerDeleted = result.ok && result.deleted;
          } catch { /* Retain the deletion record until the provider acknowledges it. */ }
        }
        if (!providerDeleted) {
          return { ok: false, code: "provider_delete_pending", error: "Local voice and consent removed. Provider deletion pending. Retry when the original provider is available." };
        }
        await store().confirmProviderDelete(userId, id);
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
      const profile = store().getProfile(userId, input.profileId.trim(), true);
      if (!profile || profile.status === "deleted") {
        return { ok: false, error: "Voice profile was deleted. Export is not allowed.", code: "deleted" };
      }
      const consent = store().getConsent(profile.consentId) ?? store().getConsentForProfile(profile.id);
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
      const profile = store().getProfile(userId, profileId.trim(), true);
      if (!profile || profile.status === "deleted") {
        return { ok: false, error: "Voice profile was deleted. Consent export is not allowed.", code: "deleted" };
      }
      const consent = store().getConsent(profile.consentId) ?? store().getConsentForProfile(profile.id);
      if (!consent) {
        return { ok: false, error: "Verified consent is required to export.", code: "missing_consent" };
      }
      const payload = buildConsentExportPayload(profile, consent);
      assertConsentExportHasNoSecrets(payload);
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
