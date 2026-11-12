/**
 * Honest Speak failure codes. The Error Banners lane reads docs/voice/ERROR_CONTRACT.md.
 * This module only names the code, the one-line sentence, and which function a retry calls.
 * It does not render a banner.
 */

export const SPEAK_RETRY = {
  start: "startDirectSpeak",
  chat: "retrySpeakChatTurn",
  play: "replaySpeakAudio",
} as const;

export type SpeakRetryName = (typeof SPEAK_RETRY)[keyof typeof SPEAK_RETRY];

export type SpeakCode =
  | "unauthenticated"
  | "session_expired"
  | "provider_not_configured"
  | "network_failure"
  | "playback_blocked"
  | "chat_failed"
  | "empty_transcript"
  | "mic_denied"
  | "mic_missing"
  | "rate_limited"
  | "emergency_stop";

export type SpeakFailureSpec = {
  code: SpeakCode;
  message: string;
  retryable: boolean;
  retry: SpeakRetryName;
};

export const SPEAK_FAILURES: Record<SpeakCode, SpeakFailureSpec> = {
  unauthenticated: {
    code: "unauthenticated",
    message: "Sign in is required before using Speak.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
  session_expired: {
    code: "session_expired",
    message: "Your session expired. Sign in again. Nothing was spoken.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
  provider_not_configured: {
    code: "provider_not_configured",
    message: "No speech key is configured. Nothing was transcribed or spoken.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
  network_failure: {
    code: "network_failure",
    message: "The voice request failed. Nothing was substituted.",
    retryable: true,
    retry: SPEAK_RETRY.start,
  },
  playback_blocked: {
    code: "playback_blocked",
    message: "The browser blocked playback. Nothing was played.",
    retryable: true,
    retry: SPEAK_RETRY.play,
  },
  chat_failed: {
    code: "chat_failed",
    message: "The chat turn failed. Nothing was spoken.",
    retryable: true,
    retry: SPEAK_RETRY.chat,
  },
  empty_transcript: {
    code: "empty_transcript",
    message: "No words were recognized. Nothing was sent.",
    retryable: true,
    retry: SPEAK_RETRY.start,
  },
  mic_denied: {
    code: "mic_denied",
    message: "Microphone permission was denied. Nothing was transcribed.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
  mic_missing: {
    code: "mic_missing",
    message: "No microphone was found. Nothing was transcribed.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
  rate_limited: {
    code: "rate_limited",
    message: "Too many voice requests. Wait a minute.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
  emergency_stop: {
    code: "emergency_stop",
    message: "Emergency stop is on. Voice was not started.",
    retryable: false,
    retry: SPEAK_RETRY.start,
  },
};

export type SpeakFailure = SpeakFailureSpec & {
  ok: false;
  transcript?: string;
  audio?: string;
};

export function speakFailure(code: SpeakCode, extra?: { transcript?: string; audio?: string }): SpeakFailure {
  return { ok: false, ...SPEAK_FAILURES[code], ...extra };
}

const SPEAK_NOT_RETRYABLE = /sign in is required|session expired|no speech key is configured|microphone permission was denied|no microphone was found|too many voice requests|emergency stop is on/i;

/** A Retry button is honest only when repeating the same attempt can succeed. */
export function speakCanRetry(
  message: string,
  replay?: { chatCommitted?: boolean; audio?: string | null; reply?: string | null },
): boolean {
  if (SPEAK_NOT_RETRYABLE.test(message)) return false;
  if (replay?.chatCommitted && !replay.reply && !replay.audio) return false;
  return true;
}

/** User closed Speak before a provider step finished. Not a provider failure. */
export type SpeakCanceled = { ok: false; canceled: true; message: "Voice start canceled." };

export function speakCanceled(): SpeakCanceled {
  return { ok: false, canceled: true, message: "Voice start canceled." };
}

export function isSpeakCode(value: unknown): value is SpeakCode {
  return typeof value === "string" && value in SPEAK_FAILURES;
}

/**
 * xAI `expires_at` is unix seconds. Values already in milliseconds (above 1e12) stay as-is.
 * Missing expiry is unknown, not expired.
 */
export function voiceSecretExpiresAtMs(expiresAt: number): number {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return 0;
  if (expiresAt < 1e12) return expiresAt * 1000;
  return expiresAt;
}

export function voiceSecretExpired(expiresAt: number, now = Date.now()): boolean {
  const ms = voiceSecretExpiresAtMs(expiresAt);
  if (!ms) return false;
  return now >= ms;
}
