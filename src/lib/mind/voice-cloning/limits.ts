/** Limits for Voice Cloning Studio (independent of Whisper Flow limits). */

export const VCS_MAX_NAME_CHARS = 64;
export const VCS_MAX_GENERATE_CHARS = 500;
export const VCS_GENERATE_HARD_MAX = 8_000;
export const VCS_MAX_AUDIO_BASE64_CHARS = 5_400_000; // ~4 MiB decoded
export const VCS_MAX_AUDIO_DECODED_BYTES = 4_000_000;
export const VCS_MIN_AUDIO_DECODED_BYTES = 64;
export const VCS_MAX_PROFILES_PER_USER = 20;
export const VCS_CREATE_RATE_PER_MIN = 5;
export const VCS_GENERATE_RATE_PER_MIN = 10;
export const VCS_DELETE_RATE_PER_MIN = 20;
export const VCS_CHALLENGE_TTL_MS = 15 * 60_000;
export const VCS_MAX_SAMPLE_DURATION_HINT_S = 120;

export const VCS_ALLOWED_AUDIO_MIME_BASES = [
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
] as const;

export function stripControlChars(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function audioMimeBase(mime: string): string {
  return mime.trim().toLowerCase().split(";", 1)[0]!.trim();
}

export function isAllowedVcsAudioMime(mime: unknown): mime is string {
  if (typeof mime !== "string" || !mime.trim()) return false;
  return (VCS_ALLOWED_AUDIO_MIME_BASES as readonly string[]).includes(audioMimeBase(mime));
}
