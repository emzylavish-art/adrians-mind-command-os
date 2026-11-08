/** Bounds for voice transcripts and Speak text. Oversized input is refused with visible errors. */

export const MAX_VOICE_TRANSCRIPT_CHARS = 4_000;
export const MAX_SPEAK_CHARS = 500;
export const MAX_OLLAMA_TRANSCRIPT_CHARS = 2_000;

/** Strip NULs and other C0 control chars except tab/newline/carriage-return. */
export function stripControlChars(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function clampSpeakText(text: string): string {
  return stripControlChars(text).trim().slice(0, MAX_SPEAK_CHARS);
}

export function sanitizeVoiceTranscript(raw: unknown):
  | { ok: true; text: string }
  | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "The transcript was not readable. Nothing was sent." };
  }
  const text = stripControlChars(raw).trim();
  if (!text) return { ok: false, error: "No words were recognized. Nothing was sent." };
  if (text.length > MAX_VOICE_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      error: `That transcript is too long (${text.length} characters). Speak a shorter phrase and try again.`,
    };
  }
  return { ok: true, text };
}

export function clampOllamaTranscript(text: string): string {
  return stripControlChars(text).trim().slice(0, MAX_OLLAMA_TRANSCRIPT_CHARS);
}
