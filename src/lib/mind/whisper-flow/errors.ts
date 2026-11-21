/** Honest Whisper Flow mic / browser / STT error copy. Never fake success. */

export const WHISPER_UNSUPPORTED =
  "This browser cannot record audio for Whisper Flow (MediaRecorder / getUserMedia missing). Nothing was transcribed.";

export const WHISPER_INSECURE =
  "Microphone capture needs a secure context (HTTPS or localhost). Whisper Flow was not started.";

export const WHISPER_MIC_DENIED =
  "Microphone permission was denied. Allow the mic for this site, then Retry. Nothing was transcribed.";

export const WHISPER_MIC_MISSING =
  "No microphone was found. Connect a mic, then Retry. Nothing was transcribed.";

export const WHISPER_MIC_ENDED =
  "The microphone track ended or the device changed. Whisper Flow stopped. Already captured audio was kept when possible.";

export const WHISPER_PROVIDER_MISSING =
  "No speech-to-text key is configured on the server. Whisper Flow cannot transcribe. Nothing was invented.";

export function mapWhisperMicError(err: unknown): string {
  if (!isSecureContextSafe()) return WHISPER_INSECURE;
  const name =
    err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name || "") : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (name === "NotAllowedError" || /permission|not allowed|denied/i.test(message)) return WHISPER_MIC_DENIED;
  if (name === "NotFoundError" || /not found|no device|Requested device not found/i.test(message)) {
    return WHISPER_MIC_MISSING;
  }
  if (/MediaRecorder|getUserMedia|mediaDevices/i.test(message)) return WHISPER_UNSUPPORTED;
  if (message.trim()) return `${message.trim()} Nothing was transcribed.`;
  return "Microphone could not be opened for Whisper Flow. Nothing was transcribed.";
}

export function isSecureContextSafe(globalObj: { isSecureContext?: boolean } = globalThis as { isSecureContext?: boolean }): boolean {
  if (typeof globalObj.isSecureContext === "boolean") return globalObj.isSecureContext;
  return true;
}

export function whisperFlowSupported(globalObj: {
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  MediaRecorder?: unknown;
  isSecureContext?: boolean;
} = globalThis as never): { ok: true } | { ok: false; error: string } {
  if (!isSecureContextSafe(globalObj)) return { ok: false, error: WHISPER_INSECURE };
  if (!globalObj.navigator?.mediaDevices?.getUserMedia) return { ok: false, error: WHISPER_UNSUPPORTED };
  if (typeof globalObj.MediaRecorder === "undefined") return { ok: false, error: WHISPER_UNSUPPORTED };
  return { ok: true };
}
