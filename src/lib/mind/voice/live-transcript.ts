/** Live interim/final transcript chip helpers (voice UI only). */

export const MAX_LIVE_TRANSCRIPT_CHARS = 240;
export const LIVE_TRANSCRIPT_DOCS_NOTE =
  "Live transcript is plain text, capped, cleared on stop and mode switch, and announced via aria-live.";

/** Strip controls and hard-cap length for on-screen live text. */
export function clampLiveTranscript(raw: unknown, max = MAX_LIVE_TRANSCRIPT_CHARS): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/** Decide display text: prefer final, else interim; never HTML. */
export function resolveLiveTranscriptDisplay(input: {
  interim?: string | null;
  final?: string | null;
  max?: number;
}): string {
  const finalText = clampLiveTranscript(input.final ?? "", input.max);
  if (finalText) return finalText;
  return clampLiveTranscript(input.interim ?? "", input.max);
}

export function shouldClearLiveTranscriptOnModeSwitch(
  previousMode: string | null | undefined,
  nextMode: string | null | undefined,
): boolean {
  if (!previousMode || !nextMode) return false;
  return previousMode !== nextMode;
}
