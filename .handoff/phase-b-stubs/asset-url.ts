/**
 * THIN SHIM — Media Storage Fleet owns the real implementation.
 * Contract (branch media-storage-fleet): getAssetUrl / getAssetUrls fall back to
 * `/${key}` when storage is unset; GET/POST /api/mind/media/asset-url mint signed
 * URLs (TTL 3600s) for private bucket `media-brand` (key = path under public/).
 * When Fleet merges, delete this shim — same path + signatures replace it cleanly.
 * This file intentionally does NOT call Supabase or implement the endpoint.
 */
export type AssetUrlResult = { url: string; expiresAt?: string };

function localFallback(key: string): string {
  return `/${String(key ?? "").replace(/^\/+/, "")}`;
}

/** Resolve one object key to a fetchable URL (signed when Fleet storage is configured). */
export async function getAssetUrl(key: string): Promise<string> {
  return localFallback(key);
}

/** Resolve many keys → map of key → url. */
export async function getAssetUrls(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = localFallback(key);
  return out;
}
