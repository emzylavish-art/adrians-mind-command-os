import { MEMORY_TEXT_MAX } from "./constants.ts";

/** Trim + length-cap memory text. Empty after trim returns "". React escapes on render. */
export function sanitizeMemoryText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, MEMORY_TEXT_MAX);
}

/** True when text is safe to store (non-empty after sanitize). */
export function isStorableMemoryText(raw: unknown): boolean {
  return sanitizeMemoryText(raw).length > 0;
}
