/** Shared runtime validators for voice server fns (H11). No network. */

export const MAX_AUDIO_BASE64_CHARS = 5_400_000; // ~4 MiB decoded
export const MAX_AUDIO_DECODED_BYTES = 4_000_000;
export const MIN_AUDIO_DECODED_BYTES = 32;
export const SPEAK_TEXT_HARD_MAX = 8_000; // reject before trim
export const SPEAK_TEXT_SEND_MAX = 500;
export const MAX_FILENAME_CHARS = 64;

/** Base types only; parameters (e.g. codecs=) are stripped before matching. */
export const ALLOWED_AUDIO_MIME_BASES = [
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

export type VoiceInputOk<T> = { ok: true } & T;
export type VoiceInputErr = { ok: false; error: string };
export type VoiceInputResult<T> = VoiceInputOk<T> | VoiceInputErr;

export function audioMimeBase(mime: string): string {
  return mime.trim().toLowerCase().split(";", 1)[0]!.trim();
}

export function isAllowedAudioMime(mime: unknown): mime is string {
  if (typeof mime !== "string" || !mime.trim()) return false;
  const base = audioMimeBase(mime);
  return (ALLOWED_AUDIO_MIME_BASES as readonly string[]).includes(base);
}

/** Strip paths/control chars; keep a short safe basename. */
export function sanitizeAudioFilename(filename: unknown, mimeFallback: string): string {
  const extFromMime = (() => {
    const base = audioMimeBase(mimeFallback);
    if (base.includes("webm")) return "webm";
    if (base.includes("ogg")) return "ogg";
    if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
    if (base.includes("mp4") || base.includes("m4a")) return "m4a";
    return "wav";
  })();
  const fallback = `dictation.${extFromMime}`;
  if (typeof filename !== "string" || !filename.trim()) return fallback;
  const base = filename.replace(/\\/g, "/").split("/").pop() || fallback;
  const cleaned = base.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, MAX_FILENAME_CHARS);
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  if (!/\.\w{1,8}$/.test(cleaned)) return `${cleaned}.${extFromMime}`.slice(0, MAX_FILENAME_CHARS);
  return cleaned;
}

export function validateSpeakTextInput(text: unknown): VoiceInputResult<{ text: string }> {
  if (typeof text !== "string") {
    return { ok: false, error: "Nothing to read. Text must be a short string." };
  }
  if (text.length > SPEAK_TEXT_HARD_MAX) {
    return { ok: false, error: "Text is too long to read aloud. Nothing was played." };
  }
  const trimmed = text.slice(0, SPEAK_TEXT_SEND_MAX).trim();
  if (!trimmed) return { ok: false, error: "Nothing to read." };
  return { ok: true, text: trimmed };
}

export function validateTranscribeAudioInput(input: unknown): VoiceInputResult<{
  audioBase64: string;
  mime: string;
  filename: string;
}> {
  if (input === null || typeof input !== "object") {
    return { ok: false, error: "No audio was recorded. Nothing was transcribed." };
  }
  const data = input as { audioBase64?: unknown; mime?: unknown; filename?: unknown };
  if (typeof data.audioBase64 !== "string") {
    return { ok: false, error: "Recorded audio was not a string. Nothing was transcribed." };
  }
  // Cap encoded length BEFORE any trim/decode so huge payloads never hit Buffer.from.
  if (data.audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    return { ok: false, error: "Recorded audio was too large. Nothing was transcribed." };
  }
  const raw = data.audioBase64.trim();
  if (!raw) return { ok: false, error: "No audio was recorded. Nothing was transcribed." };
  if (raw.length > MAX_AUDIO_BASE64_CHARS) {
    return { ok: false, error: "Recorded audio was too large. Nothing was transcribed." };
  }

  let mime = "audio/webm";
  if (data.mime !== undefined && data.mime !== null && data.mime !== "") {
    if (!isAllowedAudioMime(data.mime)) {
      return {
        ok: false,
        error: "That audio type is not supported. Use webm, wav, ogg, mpeg, or mp4. Nothing was transcribed.",
      };
    }
    mime = audioMimeBase(data.mime);
  }

  const filename = sanitizeAudioFilename(data.filename, mime);
  return { ok: true, audioBase64: raw, mime, filename };
}

export function decodeAudioBase64(audioBase64: string): VoiceInputResult<{ bytes: Buffer }> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(audioBase64, "base64");
  } catch {
    return { ok: false, error: "Recorded audio could not be read." };
  }
  // Buffer.from does not throw on bad base64; empty/odd garbage still yields bytes.
  if (bytes.length < MIN_AUDIO_DECODED_BYTES || bytes.length > MAX_AUDIO_DECODED_BYTES) {
    return { ok: false, error: "Recorded audio was empty or too large. Nothing was transcribed." };
  }
  return { ok: true, bytes };
}
