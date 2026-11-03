/** Map client-side STT failures to honest UI copy for Adrian's Mind Whisper Flow. */

export const STT_SIGN_IN_REQUIRED =
  "Sign in to use server transcription. Browser speech keeps working when available. Nothing was transcribed via the server.";

export function mapSttClientError(err: unknown): string {
  if (err && typeof err === "object") {
    const status = "status" in err ? Number((err as { status?: number }).status) : NaN;
    const message = "message" in err ? String((err as { message?: string }).message || "") : "";
    const error = "error" in err ? String((err as { error?: string }).error || "") : "";
    const combined = `${message} ${error}`.trim();
    if (status === 401 || /unauthorized|sign in is required|not authenticated|401\b/i.test(combined)) {
      return STT_SIGN_IN_REQUIRED;
    }
    if (combined) return combined.includes("Nothing was transcribed") ? combined : `${combined} Nothing was transcribed.`;
  }
  if (typeof err === "string" && err.trim()) {
    if (/unauthorized|sign in|401\b/i.test(err)) return STT_SIGN_IN_REQUIRED;
    return err.includes("Nothing was transcribed") ? err : `${err.trim()} Nothing was transcribed.`;
  }
  if (err instanceof Error && err.message.trim()) {
    if (/unauthorized|sign in|401\b/i.test(err.message)) return STT_SIGN_IN_REQUIRED;
    return err.message.includes("Nothing was transcribed")
      ? err.message
      : `${err.message} Nothing was transcribed.`;
  }
  return "Speech-to-text failed. Nothing was transcribed.";
}

export function isSttSignInError(message: string): boolean {
  return /Sign in to use server transcription/i.test(message) || /unauthorized/i.test(message);
}
