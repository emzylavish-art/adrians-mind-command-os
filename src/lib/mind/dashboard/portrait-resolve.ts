/**
 * Gap #19 / #11 / #40 — resolve portrait URLs with session negative cache + backoff.
 * Never invent art; fall back to portrait-dashboard.webp after a known miss.
 * Failed loads suppress retries until online or backoff elapses.
 * Prefer Fleet signed URLs (media-brand) via art-urls cache when primed.
 */
import { dashboardArtUrl, portraitArtUrl } from "./art-urls.ts";

export const PORTRAIT_FALLBACK_KEY = "dashboard-3d/art/portrait-dashboard.webp";
/** Sync fallback path (or signed URL once art-urls cache is primed). */
export const PORTRAIT_FALLBACK_URL = dashboardArtUrl(PORTRAIT_FALLBACK_KEY);

const missing = new Set<string>();
/** botId → earliest epoch ms when a retry is allowed */
const retryAfterMs = new Map<string, number>();
const BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000];
const failCount = new Map<string, number>();

export function portraitUrlForBot(botId: string, nowMs = Date.now()): string {
  const id = String(botId || "").trim();
  if (!id || missing.has(id)) return dashboardArtUrl(PORTRAIT_FALLBACK_KEY);
  const until = retryAfterMs.get(id);
  if (until != null && nowMs < until) return dashboardArtUrl(PORTRAIT_FALLBACK_KEY);
  return portraitArtUrl(id);
}

export function markPortraitMissing(botId: string, nowMs = Date.now()): void {
  const id = String(botId || "").trim();
  if (!id) return;
  missing.add(id);
  const n = (failCount.get(id) ?? 0) + 1;
  failCount.set(id, n);
  const delay = BACKOFF_MS[Math.min(n - 1, BACKOFF_MS.length - 1)]!;
  retryAfterMs.set(id, nowMs + delay);
}

/** Allow a single retry when the browser reports connectivity restored. */
export function clearPortraitBackoffOnOnline(): void {
  retryAfterMs.clear();
  // Keep `missing` so we still prefer fallback until a deliberate retry via URL.
}

export function isPortraitMissing(botId: string): boolean {
  return missing.has(String(botId || "").trim());
}

/** Test helper */
export function clearPortraitMissingCacheForTests(): void {
  missing.clear();
  retryAfterMs.clear();
  failCount.clear();
}

export function isPortraitFallbackSrc(src: string): boolean {
  try {
    const path = src.includes("://") ? new URL(src).pathname : src;
    return path.endsWith("/portrait-dashboard.webp") || path.endsWith("portrait-dashboard.webp");
  } catch {
    return src.includes("portrait-dashboard.webp");
  }
}
