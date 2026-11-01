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

/** Collect image File objects from a clipboard / dataTransfer, same MIME guards as attach. */
export function collectClipboardImageFiles(
  clipboard: { items?: ArrayLike<{ type: string; kind?: string; getAsFile?: () => File | null }>; files?: ArrayLike<File> } | null | undefined,
  limit = 4,
): File[] {
  if (!clipboard) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null | undefined) => {
    if (!file) return;
    const mime = (file.type || "").toLowerCase();
    const name = file.name || "";
    const okMime = mime.startsWith("image/") && !mime.includes("svg");
    const okExt = /\.(png|jpe?g|gif|webp)$/i.test(name);
    if (!okMime && !okExt) return;
    if (mime === "image/svg+xml") return;
    const key = `${name}:${file.size}:${mime}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  const items = clipboard.items ? Array.from(clipboard.items as ArrayLike<{ type: string; getAsFile?: () => File | null }>) : [];
  for (const item of items) {
    if ((item.type || "").startsWith("image/") && item.getAsFile) push(item.getAsFile());
  }
  const files = clipboard.files ? Array.from(clipboard.files as ArrayLike<File>) : [];
  for (const file of files) push(file);
  return out.slice(0, Math.max(0, limit));
}
