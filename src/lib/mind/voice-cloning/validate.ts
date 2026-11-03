import {
  audioMimeBase,
  isAllowedVcsAudioMime,
  stripControlChars,
  VCS_GENERATE_HARD_MAX,
  VCS_MAX_AUDIO_BASE64_CHARS,
  VCS_MAX_AUDIO_DECODED_BYTES,
  VCS_MAX_GENERATE_CHARS,
  VCS_MAX_NAME_CHARS,
  VCS_MIN_AUDIO_DECODED_BYTES,
} from "./limits.ts";
import { isBlockedPublicFigureName, isValidAttestation, normalizeProfileName } from "./consent.ts";
import type { ConsentAttestation } from "./types.ts";

export type VcsOk<T> = { ok: true } & T;
export type VcsErr = { ok: false; error: string; code?: string };
export type VcsResult<T> = VcsOk<T> | VcsErr;

function decodeBase64Len(b64: string): number {
  const cleaned = b64.replace(/\s+/g, "");
  if (!cleaned || /[^A-Za-z0-9+/=]/.test(cleaned)) return -1;
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

export function validateProfileName(raw: unknown): VcsResult<{ name: string }> {
  const name = normalizeProfileName(raw);
  if (!name) return { ok: false, error: "Enter a short name for this voice profile.", code: "bad_name" };
  if (name.length > VCS_MAX_NAME_CHARS) {
    return { ok: false, error: `Name is too long (max ${VCS_MAX_NAME_CHARS} characters).`, code: "bad_name" };
  }
  if (isBlockedPublicFigureName(name)) {
    return {
      ok: false,
      error: "That name looks like a public figure or third party. Unauthorized impersonation is blocked.",
      code: "blocked_name",
    };
  }
  return { ok: true, name };
}

export function validateAttestation(raw: unknown): VcsResult<{ attestation: ConsentAttestation }> {
  if (!isValidAttestation(raw)) {
    return {
      ok: false,
      error: "Confirm this is your own voice or that you have the speaker's written permission.",
      code: "missing_consent",
    };
  }
  return { ok: true, attestation: raw };
}

export function validateAudioBase64(input: {
  audioBase64: unknown;
  mime: unknown;
  label: string;
}): VcsResult<{ audioBase64: string; mime: string; decodedBytes: number }> {
  if (typeof input.audioBase64 !== "string" || !input.audioBase64.trim()) {
    return { ok: false, error: `${input.label}: no audio was provided.`, code: "bad_audio" };
  }
  if (input.audioBase64.length > VCS_MAX_AUDIO_BASE64_CHARS) {
    return { ok: false, error: `${input.label}: audio is too large.`, code: "audio_too_large" };
  }
  if (!isAllowedVcsAudioMime(input.mime)) {
    return {
      ok: false,
      error: `${input.label}: unsupported audio type. Use wav, webm, ogg, mp3, or m4a.`,
      code: "bad_mime",
    };
  }
  const decodedBytes = decodeBase64Len(input.audioBase64);
  if (decodedBytes < 0) {
    return { ok: false, error: `${input.label}: audio encoding was not readable.`, code: "bad_audio" };
  }
  if (decodedBytes < VCS_MIN_AUDIO_DECODED_BYTES) {
    return { ok: false, error: `${input.label}: audio is too short.`, code: "audio_too_small" };
  }
  if (decodedBytes > VCS_MAX_AUDIO_DECODED_BYTES) {
    return { ok: false, error: `${input.label}: audio is too large.`, code: "audio_too_large" };
  }
  return {
    ok: true,
    audioBase64: input.audioBase64.replace(/\s+/g, ""),
    mime: audioMimeBase(String(input.mime)),
    decodedBytes,
  };
}

export function validateGenerateText(raw: unknown): VcsResult<{ text: string }> {
  if (typeof raw !== "string") {
    return { ok: false, error: "Nothing to read. Text must be a short string.", code: "bad_text" };
  }
  if (raw.length > VCS_GENERATE_HARD_MAX) {
    return { ok: false, error: "Text is too long to synthesize. Nothing was generated.", code: "text_too_long" };
  }
  const text = stripControlChars(raw).trim().slice(0, VCS_MAX_GENERATE_CHARS);
  if (!text) return { ok: false, error: "Nothing to read.", code: "bad_text" };
  return { ok: true, text };
}

export function decodeAudioBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}
