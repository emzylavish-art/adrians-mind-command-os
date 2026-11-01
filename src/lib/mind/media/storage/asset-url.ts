/**
 * THIN SHIM — Media Storage Fleet owns the real implementation on branch
 * `media-storage-fleet` (not yet on origin at fold time). Same path + signatures
 * so their commit replaces this file cleanly.
 *
 * Contract:
 * - getAssetUrl(key) / getAssetUrls(keys)
 * - Fallback `/${key}` when storage is not configured
 * - Fleet endpoints (NOT implemented here): GET/POST /api/mind/media/asset-url
 * - Bucket: private `media-brand`; key = path under public/ (public/art/x.webp → art/x.webp)
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
