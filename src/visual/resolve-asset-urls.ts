import { getAssetUrls } from "@/lib/mind/media/storage/asset-url";
import { VISUAL_ASSET_KEYS, VISUAL_ASSET_MAP, type VisualAssetId } from "./asset-keys.ts";

/**
 * Resolve visual asset object keys → signed HTTPS URLs (Fleet media-brand),
 * falling back to same-origin `/<key>` when signing is unavailable.
 */
export async function resolveVisualAssetUrls(
  keys: string[] = VISUAL_ASSET_KEYS,
): Promise<Record<string, string>> {
  try {
    return await getAssetUrls(keys);
  } catch {
    const out: Record<string, string> = {};
    for (const key of keys) out[key] = `/${key.replace(/^\/+/, "")}`;
    return out;
  }
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
