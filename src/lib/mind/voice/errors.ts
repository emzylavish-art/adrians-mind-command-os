/** Map thrown / returned voice failures to always-visible user text. Never silent. */

export const VOICE_SIGN_IN_REQUIRED =
  "Sign in is required. Open Sign in, then try Start voice again.";

export const VOICE_START_FAILED = "Voice capture could not start.";

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
  return trimmed;
}

/** Only persist after the first client hydrate so the SSR default cannot clobber localStorage. */
export function shouldPersistVoiceMode(hydrated: boolean): boolean {
  return hydrated;
}
