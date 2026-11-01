/**
 * Gap #19 / #11 follow-up — resolve portrait URLs with session negative cache.
 * Never invent art; fall back to portrait-dashboard.webp after a known 404.
 */
export const PORTRAIT_FALLBACK_URL = "/dashboard-3d/art/portrait-dashboard.webp";

const missing = new Set<string>();

export function portraitUrlForBot(botId: string): string {
  const id = String(botId || "").trim();
  if (!id || missing.has(id)) return PORTRAIT_FALLBACK_URL;
  return `/dashboard-3d/art/portrait-${id}.webp`;
}

export function markPortraitMissing(botId: string): void {
  const id = String(botId || "").trim();
  if (id) missing.add(id);
}

export function isPortraitMissing(botId: string): boolean {
  return missing.has(String(botId || "").trim());
}

/** Test helper */
export function clearPortraitMissingCacheForTests(): void {
  missing.clear();
}
