import { previewPathPrefix } from "../../../preview-path-prefix.ts";

/**
 * Client-safe brand asset URLs. This file must not import server credentials,
 * Node built-ins, or the service key. The visual layer imports it directly:
 *
 *   import { getAssetUrl, getAssetUrls } from "@/lib/mind/media/storage/asset-url";
 *
 * Do not import it through the server storage barrel.
 */

export const BRAND_BUCKET = "media-brand";
export const BRAND_ASSET_HOST = "xarxhdsnprpnosimehon.supabase.co";
export const ASSET_SIGNED_TTL_SECONDS = 3600;
/** Drop a cached URL this long before the signed URL expires. */
export const ASSET_CACHE_SKEW_MS = 5 * 60 * 1000;
/** Server fallback URLs expire soon so a later upload is picked up. */
export const ASSET_FALLBACK_TTL_SECONDS = 10 * 60;
export const ASSET_URL_BATCH_MAX = 40;

const BRAND_EXTENSIONS = new Set(["png", "jpeg", "jpg", "webp", "avif", "svg", "mp4", "webm"]);
const PRIVATE_EXTENSIONS = new Set([...BRAND_EXTENSIONS, "gif", "mov", "mp3", "m4a", "wav", "ogg", "aac", "flac"]);

/** User media. Signing these requires a signed-in session. */
export const PRIVATE_ASSET_BUCKETS = ["media-images", "media-video", "media-audio", "media-camera"] as const;
export type PrivateAssetBucket = (typeof PRIVATE_ASSET_BUCKETS)[number];
export type AssetBucket = typeof BRAND_BUCKET | PrivateAssetBucket;

export type ParsedAssetKey = {
  /** Canonical key returned to callers and used as the response map key. */
  key: string;
  bucket: AssetBucket;
  objectKey: string;
  /** True for media-images, media-video, media-audio, and media-camera. */
  private: boolean;
};

const memoryCache = new Map<string, { url: string; expiresAtMs: number }>();

export type AssetUrlClientDeps = {
  now?: number;
  fetchImpl?: typeof fetch;
  cache?: Map<string, { url: string; expiresAtMs: number }>;
};

export function clearAssetUrlCache(): void {
  memoryCache.clear();
}

/** Public-file fallback: `public/<key>` is served at `/<key>`. */
export function publicAssetPath(key: string): string {
  return `/${key}`;
}

function canonicalObjectKey(raw: string, extensions: Set<string>): string | null {
  if (!raw || raw.length > 240) return null;
  if (raw.startsWith("/") || raw.startsWith("\\")) return null;
  if (raw.includes("\\") || raw.includes("..") || raw.includes("//")) return null;
  if (/[?#]/.test(raw) || [...raw].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const segments = raw.split("/");
  if (segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) return null;
  const fileName = segments[segments.length - 1] ?? "";
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = fileName.slice(dot + 1).toLowerCase();
  if (!extensions.has(extension)) return null;
  return raw;
}

/**
 * Brand keys are paths under `public/` (`brand/textures/noise.webp` → media-brand).
 * Prefix a private bucket (`media-images/...`, `media-video/...`, `media-audio/...`,
 * `media-camera/...`) to address user media. Those keys require a signed-in session.
 */
export function parseAssetKey(value: unknown): ParsedAssetKey | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  for (const bucket of PRIVATE_ASSET_BUCKETS) {
    const prefix = `${bucket}/`;
    if (!trimmed.startsWith(prefix)) continue;
    const objectKey = canonicalObjectKey(trimmed.slice(prefix.length), PRIVATE_EXTENSIONS);
    if (!objectKey) return null;
    return { key: `${bucket}/${objectKey}`, bucket, objectKey, private: true };
  }
  if (trimmed.startsWith(`${BRAND_BUCKET}/`)) {
    const objectKey = canonicalObjectKey(trimmed.slice(BRAND_BUCKET.length + 1), BRAND_EXTENSIONS);
    if (!objectKey) return null;
    return { key: objectKey, bucket: BRAND_BUCKET, objectKey, private: false };
  }
  const objectKey = canonicalObjectKey(trimmed, BRAND_EXTENSIONS);
  if (!objectKey) return null;
  return { key: objectKey, bucket: BRAND_BUCKET, objectKey, private: false };
}

/**
 * Accept the asset's path under `public/` with that prefix removed.
 * Rejects traversal, a leading slash, and extensions the bucket does not allow.
 */
export function normalizeAssetKey(value: unknown): string | null {
  return parseAssetKey(value)?.key ?? null;
}

export function isValidAssetKey(value: unknown): value is string {
  return normalizeAssetKey(value) != null;
}

function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}${path}`;
}

function remember(
  cache: Map<string, { url: string; expiresAtMs: number }>,
  key: string,
  url: string,
  expiresAtMs: number,
  now: number,
) {
  if (!Number.isFinite(expiresAtMs)) return;
  if (now >= expiresAtMs - ASSET_CACHE_SKEW_MS) return;
  cache.set(key, { url, expiresAtMs });
}

function cachedUrl(
  cache: Map<string, { url: string; expiresAtMs: number }>,
  key: string,
  now: number,
): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now >= hit.expiresAtMs - ASSET_CACHE_SKEW_MS) {
    cache.delete(key);
    return null;
  }
  return hit.url;
}

/** Accept only the public fallback or a signed URL on the media project for this key's bucket. */
export function acceptAssetUrl(key: string, value: unknown): string {
  const fallback = publicAssetPath(key);
  const target = parseAssetKey(key);
  if (!target) return fallback;
  if (value === fallback) return fallback;
  if (typeof value !== "string" || !value) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fallback;
  }
  if (parsed.protocol !== "https:") return fallback;
  if (parsed.username || parsed.password) return fallback;
  if (parsed.hostname !== BRAND_ASSET_HOST) return fallback;
  if (!parsed.pathname.startsWith(`/storage/v1/object/sign/${target.bucket}/`)) return fallback;
  return parsed.toString();
}

async function fetchAssetUrls(
  keys: string[],
  fetchImpl: typeof fetch,
): Promise<Record<string, { url?: unknown; expiresAt?: unknown }>> {
  if (keys.length === 1) {
    const key = keys[0] ?? "";
    const response = await fetchImpl(apiUrl(`/api/mind/media/asset-url?key=${encodeURIComponent(key)}`), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return {};
    const body = (await response.json()) as { url?: unknown; expiresAt?: unknown };
    return { [key]: body };
  }
  const response = await fetchImpl(apiUrl("/api/mind/media/asset-url"), {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  if (!response.ok) return {};
  const body = (await response.json()) as { urls?: Record<string, { url?: unknown; expiresAt?: unknown }> };
  return body.urls ?? {};
}

/**
 * Resolve brand asset URLs. Cached until five minutes before `expiresAt`.
 * A missing object or an unconfigured store falls back to `/` + key.
 */
export async function getAssetUrls(keys: string[], deps: AssetUrlClientDeps = {}): Promise<Record<string, string>> {
  const now = deps.now ?? Date.now();
  const cache = deps.cache ?? memoryCache;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const unique: string[] = [];
  for (const key of keys) {
    const normalized = normalizeAssetKey(key);
    if (!normalized) throw new Error("Invalid asset key.");
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const key of unique) {
    const hit = cachedUrl(cache, key, now);
    if (hit) out[key] = hit;
    else missing.push(key);
  }
  if (missing.length === 0) return out;
  let resolved: Record<string, { url?: unknown; expiresAt?: unknown }> = {};
  try {
    resolved = await fetchAssetUrls(missing, fetchImpl);
  } catch {
    resolved = {};
  }
  for (const key of missing) {
    const row = resolved[key];
    const url = acceptAssetUrl(key, row?.url);
    const expiresAtMs = typeof row?.expiresAt === "string" ? Date.parse(row.expiresAt) : NaN;
    remember(cache, key, url, expiresAtMs, now);
    out[key] = url;
  }
  return out;
}

export async function getAssetUrl(key: string, deps: AssetUrlClientDeps = {}): Promise<string> {
  const urls = await getAssetUrls([key], deps);
  const normalized = normalizeAssetKey(key);
  if (!normalized || !urls[normalized]) throw new Error("Invalid asset key.");
  return urls[normalized];
}
