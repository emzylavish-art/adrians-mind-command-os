/**
 * Guard clipboard / paste payloads that try to smuggle javascript: or HTML into image paths.
 */
import { isSafeImageSrc, sanitizeMediaLabel } from "./harden.ts";

export function sanitizePastedImageCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(javascript|vbscript|data:text\/html)/i.test(trimmed)) return null;
  if (isSafeImageSrc(trimmed)) return trimmed;
  return null;
}

/** Strip HTML wrappers and reject scripty pastes; keep plain text for the composer. */
export function sanitizeComposerPasteText(raw: string): string {
  const withoutScripts = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  // If the paste is mostly HTML with an image, prefer extracting a safe src.
  const img = withoutScripts.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (img?.[1] && sanitizePastedImageCandidate(img[1])) {
    // Do not auto-attach from HTML paste here — caller may use the candidate.
  }
  const text = withoutScripts
    .replace(/<[^>]+>/g, " ")
    .replace(/javascript:/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function extractSafeImageSrcFromHtml(html: string): string | null {
  const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!img?.[1]) return null;
  return sanitizePastedImageCandidate(img[1]);
}

export function safeAttachmentNameFromPaste(name: unknown): string {
  return sanitizeMediaLabel(name) || "pasted-image";
}
