/** Honest copy when a persistence write fails. Browser content is never wiped. */
export const SAVE_FAIL = "The server copy could not be saved. The browser copy was kept.";

/** Pure helper: classify a save result without UI or network. */
export function saveFailureMessage(result: { ok: true } | { ok: false; error?: string }): string | null {
  if (result.ok) return null;
  return result.error || SAVE_FAIL;
}
