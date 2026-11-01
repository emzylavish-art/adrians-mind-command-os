import { MAX_DATA_URL_CHARS, MAX_IMAGE_EDGE } from "./types.ts";

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i;

export function isImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && DATA_URL_RE.test(value.trim());
}

export function parseImageDataUrl(value: string): { ok: true; mime: string; base64: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  const match = trimmed.match(DATA_URL_RE);
  if (!match) return { ok: false, error: "That image data URL is not a supported PNG, JPEG, GIF, or WebP." };
  const mime = match[1]!.toLowerCase().replace("image/jpg", "image/jpeg");
  const base64 = match[2]!.replace(/\s+/g, "");
  if (!base64) return { ok: false, error: "That image data URL is empty." };
  if (`data:${mime};base64,${base64}`.length > MAX_DATA_URL_CHARS) {
    return { ok: false, error: "That image is too large after encoding. Downscale it and try again." };
  }
  return { ok: true, mime, base64 };
}

export function normalizeImageDataUrl(value: string): string | null {
  const parsed = parseImageDataUrl(value);
  if (!parsed.ok) return null;
  return `data:${parsed.mime};base64,${parsed.base64}`;
}

/** Pure size math used by the browser canvas helper and unit tests. */
export function fitWithinBox(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number; scaled: boolean } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1, height: 1, scaled: false };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height), scaled: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

export function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "image/jpeg";
}
