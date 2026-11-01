/**
 * Gap #13 / queue #36 — persist last-good status across reload (sessionStorage).
 * Never invents bots/fields; only stores what a successful poll already validated.
 */

export const STATUS_CACHE_KEY = "dash3d:last-good-status:v1";

export type StatusCacheEnvelope<T> = {
  savedAt: string; // ISO
  data: T;
};

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function isIso(s: unknown): s is string {
  return typeof s === "string" && s.length >= 10 && !Number.isNaN(Date.parse(s));
}

/** Accept only bags that look like a prior good status (bots array required). */
export function isStatusCachePayload(data: unknown): data is { bots: unknown[] } {
  return !!data && typeof data === "object" && Array.isArray((data as { bots?: unknown }).bots);
}

export function readStatusCache<T>(
  storage: StorageLike | null | undefined,
  key = STATUS_CACHE_KEY,
): StatusCacheEnvelope<T> | null {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StatusCacheEnvelope<T>>;
    if (!isIso(parsed.savedAt) || !isStatusCachePayload(parsed.data)) return null;
    return { savedAt: parsed.savedAt, data: parsed.data as T };
  } catch {
    return null;
  }
}

export function writeStatusCache<T>(
  storage: StorageLike | null | undefined,
  data: T,
  savedAt = new Date().toISOString(),
  key = STATUS_CACHE_KEY,
): boolean {
  if (!storage || typeof storage.setItem !== "function") return false;
  if (!isStatusCachePayload(data)) return false;
  if (!isIso(savedAt)) savedAt = new Date().toISOString();
  try {
    const envelope: StatusCacheEnvelope<T> = { savedAt, data };
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    // Quota / private mode — honest no-op
    return false;
  }
}

export function clearStatusCache(storage: StorageLike | null | undefined, key = STATUS_CACHE_KEY): void {
  if (!storage || typeof storage.removeItem !== "function") return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Format savedAt for the stale banner in Africa/Lagos (WAT). */
export function formatStaleSinceWAT(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${fmt.format(d)} WAT`;
  } catch {
    return `${d.toISOString().slice(11, 16)} UTC`;
  }
}
