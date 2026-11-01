/**
 * Media-lane adversarial hardening helpers (client-safe; no Node APIs).
 */

export const MAX_DECODE_PIXELS = 16_000_000; // reject decompression bombs before canvas work
export const MAX_CLOUD_FILE_ID_LEN = 128;
export const MAX_IMAGINE_BODY_CHARS = 6_000_000;

const SAFE_IMAGE_SRC_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

/** True only for http(s) https remote or safe image data URLs — never javascript:/data:text/html. */
export function isSafeImageSrc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^(javascript|vbscript|data):/i.test(trimmed) && !SAFE_IMAGE_SRC_RE.test(trimmed)) return false;
  if (SAFE_IMAGE_SRC_RE.test(trimmed)) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Strip HTML/control characters from filenames and alt text shown in UI. */
export function sanitizeMediaLabel(value: unknown, max = 120): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>`"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned || undefined;
}

/** Normalize Imagine prompts: strip nulls, cap length, keep Unicode. */
export function sanitizeImaginePrompt(raw: unknown, max = 4000): { ok: true; prompt: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Write a prompt for Imagine." };
  const prompt = raw.replace(/\u0000/g, "").normalize("NFC").trim();
  if (!prompt) return { ok: false, error: "Write a prompt for Imagine." };
  if (prompt.length > max) return { ok: false, error: `That Imagine prompt is too long (max ${max} characters).` };
  return { ok: true, prompt };
}

/** Drive/OneDrive file ids: reject traversal and odd schemes. */
export function isSafeCloudFileId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim();
  if (!id || id.length > MAX_CLOUD_FILE_ID_LEN) return false;
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) return false;
  if (/^(https?:|file:|data:)/i.test(id)) return false;
  // Google Drive ids are typically alphanumeric/_-
  return /^[A-Za-z0-9_-]+$/.test(id);
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\]|metadata\.google|metadata\.internal)/i;

/** Block SSRF targets for server-side image URL downloads. */
export function isSafeRemoteImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host)) return false;
  if (/^(0|127)\./.test(host)) return false;
  // IPv4 private ranges
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

/** Sniff common image magic bytes from a base64 payload. */
export function sniffImageMimeFromBase64(base64: string): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  try {
    const cleaned = base64.replace(/\s+/g, "");
    if (!cleaned) return null;
    // Decode a small prefix without Node Buffer for client safety.
    const bin = typeof atob === "function" ? atob(cleaned.slice(0, 48)) : Buffer.from(cleaned.slice(0, 48), "base64").toString("binary");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
    return null;
  } catch {
    return null;
  }
}

export function dimensionsLookLikeBomb(width: number, height: number, maxPixels = MAX_DECODE_PIXELS): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return true;
  if (width * height > maxPixels) return true;
  // 1×N / N×1 strip bombs: extreme aspect with a huge long edge.
  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  if (longest >= 8192 && longest / shortest >= 32) return true;
  return false;
}

export function mapImagineHttpError(status: number, message: string): string {
  const raw = typeof message === "string" ? message : "";
  // Never relay raw upstream/provider text to the client (H6).
  if (status === 401 || status === 403) return "Image generation was refused (auth or permission).";
  if (status === 429) return "Image generation is rate-limited right now. Wait a minute and try again.";
  if (status === 400 && /moderat|unsafe|policy|content/i.test(raw)) {
    return "The image request was refused by content moderation. Try a different prompt.";
  }
  if (status === 400) return "That Imagine request was invalid. Check the prompt and images.";
  if (status === 413) return "That Imagine request was too large.";
  if (status >= 500) return "The image service failed. Nothing was saved as a success.";
  if (status === 408 || /timeout/i.test(raw)) return "Image generation timed out. Nothing was saved as a success.";
  return `Image generation failed (HTTP ${status || "error"}).`;
}

/** Sliding window to blunt cost abuse on /imagine (pluggable store). */
export const IMAGINE_WINDOW_MS = 60_000;
export const IMAGINE_MAX_PER_WINDOW = 8;
/** Hard cap on n (images per generate call) — cost control (H4). */
export const IMAGINE_MAX_N = 2;

export type ImagineRateLimitStore = {
  get(key: string): number[];
  set(key: string, hits: number[]): void;
};

export function createMemoryRateLimitStore(seed: Record<string, number[]> = {}): ImagineRateLimitStore {
  const map = new Map<string, number[]>(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  return {
    get(key) {
      return [...(map.get(key) ?? [])];
    },
    set(key, hits) {
      map.set(key, [...hits]);
    },
  };
}

let imagineRateStore: ImagineRateLimitStore = createMemoryRateLimitStore();

export function setImagineRateLimitStore(store: ImagineRateLimitStore) {
  imagineRateStore = store;
}

export function getImagineRateLimitStore(): ImagineRateLimitStore {
  return imagineRateStore;
}

export function imagineRateLimitKey(parts: { ownerId?: string; userId?: string; sessionId?: string }): string {
  const owner = (parts.ownerId || parts.userId || "anon").trim() || "anon";
  const session = (parts.sessionId || "default").trim() || "default";
  return `imagine:${owner}:${session}`;
}

export function checkImagineRateLimit(
  userIdOrKey: string,
  now = Date.now(),
  sessionId?: string,
): { ok: true } | { ok: false; error: string; retryAfterSec: number } {
  const key = userIdOrKey.includes("imagine:")
    ? userIdOrKey
    : imagineRateLimitKey({ userId: userIdOrKey, sessionId });
  const cutoff = now - IMAGINE_WINDOW_MS;
  const prior = imagineRateStore.get(key).filter((t) => t > cutoff);
  if (prior.length >= IMAGINE_MAX_PER_WINDOW) {
    const retryAfterSec = Math.max(1, Math.ceil((prior[0]! + IMAGINE_WINDOW_MS - now) / 1000));
    return { ok: false, error: "Imagine is rate-limited. Wait a minute before generating more images.", retryAfterSec };
  }
  prior.push(now);
  imagineRateStore.set(key, prior);
  return { ok: true };
}

/** Test helper — reset to a fresh memory store. */
export function resetImagineRateLimitForTests() {
  imagineRateStore = createMemoryRateLimitStore();
}
