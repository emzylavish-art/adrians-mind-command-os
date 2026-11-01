/** Map thrown / returned voice failures to always-visible user text. Never silent. */

export const VOICE_SIGN_IN_REQUIRED =
  "Sign in is required. Open Sign in, then try Start voice again.";

export const VOICE_START_FAILED = "Voice capture could not start.";

export const VOICE_MIC_DENIED =
  "Microphone permission was denied. Allow the mic for this site, then try Start voice again.";

export const VOICE_MIC_MISSING =
  "No microphone was found. Connect a mic, then try Start voice again.";

export const VOICE_CONNECTION_DROPPED =
  "Voice connection dropped. The mic was released. Press Start voice to try again.";

export function formatVoiceClientError(err: unknown): string {
  if (err && typeof err === "object" && "ok" in err && (err as { ok?: boolean }).ok === false) {
    const message = String((err as { error?: string }).error ?? "").trim();
    if (message === "Unauthorized") return VOICE_SIGN_IN_REQUIRED;
    if (message) return message;
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const trimmed = message.trim();
  if (!trimmed) return VOICE_START_FAILED;
  if (trimmed === "Unauthorized" || /^unauthorized\b/i.test(trimmed)) return VOICE_SIGN_IN_REQUIRED;
  const mic = formatMicCaptureError(err);
  if (mic) return mic;
  return trimmed;
}

export function formatMicCaptureError(err: unknown): string | null {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (name === "NotAllowedError" || /permission|not allowed|denied/i.test(message)) return VOICE_MIC_DENIED;
  if (name === "NotFoundError" || /not found|no device|Requested device not found/i.test(message)) return VOICE_MIC_MISSING;
  return null;
}

/** Only persist after the first client hydrate so the SSR default cannot clobber localStorage. */
export function shouldPersistVoiceMode(hydrated: boolean): boolean {
  return hydrated;
}
