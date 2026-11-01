import { VISUAL_ASSET_KEYS, VISUAL_ASSET_MAP, type VisualAssetId } from "./asset-keys.ts";

/**
 * Resolve visual asset object keys → fetchable HTTPS (or same-origin) URLs.
 *
 * TODAY: plain `/<key>` (works with files in public/ and with Fleet helper fallback).
 *
 * SWAP (one line) when `media-storage-fleet` merges `getAssetUrls`:
 *   // import { getAssetUrls } from "@/lib/mind/media/storage/asset-url";
 *   // return getAssetUrls(keys);
 *
 * Do NOT copy asset-url.ts into this branch — only consume it after Fleet lands.
 */
export async function resolveVisualAssetUrls(
  keys: string[] = VISUAL_ASSET_KEYS,
): Promise<Record<string, string>> {
  // ——— FLEET SWAP POINT (replace the next line with getAssetUrls(keys)) ———
  const localFallback = (key: string) => `/${key.replace(/^\/+/, "")}`;
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = localFallback(key);
  return out;
  // ——— end swap point ———
}

/** Map each VisualAssetId → url string for CSS vars / img src. */
export async function resolveVisualAssetUrlById(): Promise<Record<VisualAssetId, string>> {
  const byKey = await resolveVisualAssetUrls(VISUAL_ASSET_KEYS);
  const out = {} as Record<VisualAssetId, string>;
  for (const entry of Object.values(VISUAL_ASSET_MAP)) {
    out[entry.id] = byKey[entry.key] ?? `/${entry.key}`;
  }
  return out;
}
