/**
 * Dashboard 3D / Imagine scene art via Media Storage Fleet signed URLs.
 * Object keys match public/ paths (media-brand). Sync helpers return cache or
 * same-origin fallback; call ensureDashboardArtUrls() before TextureLoader work.
 */
import { ASSET_URL_BATCH_MAX, getAssetUrls } from "../../mind/media/storage/asset-url.ts";

export const DASHBOARD_ART_KEYS = ["dashboard-3d/art/backdrop-city.webp", "dashboard-3d/art/backdrop-interior.webp", "dashboard-3d/art/backdrop-nebula.webp", "dashboard-3d/art/building-gap-cycle.webp", "dashboard-3d/art/building-guild.webp", "dashboard-3d/art/building-orchestrator.webp", "dashboard-3d/art/portrait-conductor.webp", "dashboard-3d/art/portrait-cosmos-light.webp", "dashboard-3d/art/portrait-cosmos-motion.webp", "dashboard-3d/art/portrait-cosmos-painter.webp", "dashboard-3d/art/portrait-dashboard.webp", "dashboard-3d/art/portrait-error-banners.webp", "dashboard-3d/art/portrait-gap-dispatcher.webp", "dashboard-3d/art/portrait-gap.webp", "dashboard-3d/art/portrait-grok-build.webp", "dashboard-3d/art/portrait-hp-pairing.webp", "dashboard-3d/art/portrait-logic.webp", "dashboard-3d/art/portrait-mcp-integration.webp", "dashboard-3d/art/portrait-media-integration.webp", "dashboard-3d/art/portrait-merge-gate.webp", "dashboard-3d/art/portrait-rea-feature-hunter.webp", "dashboard-3d/art/portrait-rea.webp", "dashboard-3d/art/portrait-visual-polish.webp", "dashboard-3d/art/portrait-voice-integration.webp", "dashboard-3d/art/portrait-voice-wiring.webp", "dashboard-3d/art/portrait-xai-verification.webp", "dashboard-3d/art/scene-agents-walk.webp", "dashboard-3d/art/scene-city-street.webp", "dashboard-3d/art/scene-collab-tower.webp", "dashboard-3d/art/scene-fleet-guild.webp", "dashboard-3d/art/scene-merge-beacon.webp", "dashboard-3d/art/scene-notion-archive.webp", "dashboard-3d/art/scene-operator-character.webp"] as const;

export type DashboardArtKey = (typeof DASHBOARD_ART_KEYS)[number];

const cache = new Map<string, string>();
let inflight: Promise<void> | null = null;

function fallback(key: string): string {
  return `/${key.replace(/^\/+/, "")}`;
}

/** Sync: signed URL if already resolved, else public fallback. */
export function dashboardArtUrl(keyOrPath: string): string {
  const key = keyOrPath.replace(/^\/+/, "");
  return cache.get(key) ?? fallback(key);
}

export function portraitArtUrl(botId: string): string {
  const id = String(botId || "").trim();
  if (!id) return dashboardArtUrl("dashboard-3d/art/portrait-dashboard.webp");
  return dashboardArtUrl(`dashboard-3d/art/portrait-${id}.webp`);
}

export async function ensureDashboardArtUrls(keys: readonly string[] = DASHBOARD_ART_KEYS): Promise<void> {
  const missing = keys.map((k) => k.replace(/^\/+/, "")).filter((k) => !cache.has(k));
  if (missing.length === 0) return;
  if (inflight) {
    await inflight;
    return;
  }
  inflight = (async () => {
    try {
      for (let i = 0; i < missing.length; i += ASSET_URL_BATCH_MAX) {
        const chunk = missing.slice(i, i + ASSET_URL_BATCH_MAX);
        const urls = await getAssetUrls(chunk);
        for (const key of chunk) {
          cache.set(key, urls[key] ?? fallback(key));
        }
      }
    } catch {
      for (const key of missing) cache.set(key, fallback(key));
    } finally {
      inflight = null;
    }
  })();
  await inflight;
}

/** Test helper */
export function clearDashboardArtUrlCacheForTests(): void {
  cache.clear();
  inflight = null;
}
