/**
 * Export helpers for generated audio + consent records.
 * Filenames: sanitized profile name + timestamp. No secrets.
 */
import type { ConsentRecord, ExportAudioFormat, VoiceProfile } from "./types.ts";

export function sanitizeFilenamePart(raw: string): string {
  const cleaned = raw
    .trim()
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
  if (input.format === "mp3") {
    return { ok: true, audioBase64: input.audioBase64, mime: "audio/mpeg" };
  }
  // WAV export: if source is already wav, pass through; otherwise refuse silent re-encode
  // (no ffmpeg in serverless path). Client may download MP3; WAV offered when bytes are wav.
  const mime = input.sourceMime.toLowerCase();
  if (mime.includes("wav") || mime.includes("wave")) {
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
      consentCode: consent.consentCode,
      phraseHash: consent.phraseHash,
      speakerName: consent.speakerName,
      // transcript kept normalized (no raw audio)
      transcriptNormalized: consent.transcriptNormalized,
    },
  };
}
