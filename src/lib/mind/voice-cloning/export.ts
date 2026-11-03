/**
 * Export helpers for generated audio + consent records.
 * Filenames: sanitized profile name + timestamp. No secrets.
 */
import type { ConsentRecord, ExportAudioFormat, VoiceProfile } from "./types.ts";
import { looksLikeMp3Header, looksLikeWavHeader } from "./audio-sniff.ts";

export function sanitizeFilenamePart(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\\/g, "_")
    .replace(/\//g, "_")
    .replace(/\.\./g, "_")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/[._]+$/, "")
    .slice(0, 48);
  return cleaned || "voice";
}

export function formatExportTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function buildAudioExportFilename(profileName: string, format: ExportAudioFormat, date = new Date()): string {
  return `${sanitizeFilenamePart(profileName)}_${formatExportTimestamp(date)}.${format}`;
}

export function buildConsentExportFilename(profileName: string, date = new Date()): string {
  return `${sanitizeFilenamePart(profileName)}_consent_${formatExportTimestamp(date)}.json`;
}

/** MP3 passthrough (TTS already returns mpeg). WAV: wrap PCM if needed; for MP3 source we re-label only when already wav. */
export function prepareExportAudio(input: {
  audioBase64: string;
  sourceMime: string;
  format: ExportAudioFormat;
}): { ok: true; audioBase64: string; mime: string } | { ok: false; error: string } {
  if (!input.audioBase64) return { ok: false, error: "No generated audio to export." };
  const bytes = Uint8Array.from(Buffer.from(input.audioBase64, "base64"));
  if (input.format === "mp3") {
    if (!looksLikeMp3Header(bytes)) {
      return { ok: false, error: "MP3 export refused: bytes do not look like MPEG audio." };
    }
    return { ok: true, audioBase64: input.audioBase64, mime: "audio/mpeg" };
  }
  // WAV export: if source is already wav, pass through; otherwise refuse silent re-encode
  // (no ffmpeg in serverless path). Client may download MP3; WAV offered when bytes are wav.
  const mime = input.sourceMime.toLowerCase();
  if (mime.includes("wav") || mime.includes("wave")) {
    if (!looksLikeWavHeader(bytes)) {
      return { ok: false, error: "WAV export refused: bytes are not a valid RIFF/WAVE header." };
    }
    return { ok: true, audioBase64: input.audioBase64, mime: "audio/wav" };
  }
  return {
    ok: false,
    error: "WAV export needs WAV bytes. Download MP3, or generate again after the provider returns WAV.",
  };
}

export function buildConsentExportPayload(profile: VoiceProfile, consent: ConsentRecord): Record<string, unknown> {
  return {
    schema: "adrians-mind.voice-cloning.consent.v1",
    exportedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      name: profile.name,
      createdAt: profile.createdAt,
      status: profile.status,
      provider: profile.provider,
      providerStatus: profile.providerStatus,
      // Never include providerVoiceId raw secrets; id is ok but omit after delete.
      providerVoiceId: profile.status === "deleted" ? null : profile.providerVoiceId,
    },
    consent: {
      id: consent.id,
      createdAt: consent.createdAt,
      attestation: consent.attestation,
      // consentCode omitted — one-time challenge code must not leave the server
      phraseHash: consent.phraseHash,
      speakerName: consent.speakerName,
      // transcript kept normalized (no raw audio / samples / tokens)
      transcriptNormalized: consent.transcriptNormalized,
    },
  };
}

/** Assert consent export JSON never contains secrets or sample payloads. */
export function assertConsentExportHasNoSecrets(payload: Record<string, unknown>): void {
  const json = JSON.stringify(payload).toLowerCase();
  for (const needle of [
    "apikey",
    "api_key",
    "authorization",
    "bearer ",
    "consenttoken",
    "consent_token",
    "voice_hub_consent_secret",
    "samplebase64",
    "audiobase64",
  ]) {
    if (json.includes(needle)) {
      throw new Error(`Consent export leaked secret-like field (${needle}).`);
    }
  }
  // Token-shaped values (not provider enum names like xai-custom-voices).
  if (/sk-[a-z0-9]{8,}/i.test(json) || /bearer\s+[a-z0-9._\-]{12,}/i.test(json)) {
    throw new Error("Consent export leaked token-shaped value.");
  }
  const consent = payload.consent as Record<string, unknown> | undefined;
  if (consent && "consentCode" in consent) {
    throw new Error("Consent export must not include consentCode.");
  }
}

