import type { Health, LockRecord } from "./types.ts";

const BLOCKED_RE = /\b(blocked|error|404|unauthorized|unauthorised|fail(?:ed|ure)?)\b/i;
const DONE_RE = /\b(done|released|complete|completed)\b/i;
const CLAIMED_RE = /\b(claimed|in\s*progress|active|working)\b/i;

export const STALL_MS = 30 * 60 * 1000;

export function parseTimeMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const cleaned = value.replace(/\s*\(Africa\/Lagos\)\s*$/i, "").trim();
  const ms = Date.parse(cleaned);
  if (Number.isFinite(ms)) return ms;
  // allow date-only
  const fallback = Date.parse(cleaned.replace(" ", "T"));
  return Number.isFinite(fallback) ? fallback : null;
}

export function textLooksBlocked(status: string | null, notes: string): boolean {
  if (/\bblocked\b/i.test(status ?? "")) return true;
  if (BLOCKED_RE.test(status ?? "") && !DONE_RE.test(status ?? "")) return true;
  // Notes: only treat as blocked when they declare a blocked/error state, not when
  // they mention past Unauthorized/404 diagnostics being fixed or expected.
  if (/\b(not|no longer)\s+(a\s+)?blocked\b/i.test(notes)) return false;
  if (/\bcurrently\s+blocked\b/i.test(notes)) return true;
  if (/\bstatus:\s*(blocked|error)\b/i.test(notes)) return true;
  if (/\b(lane|bot|work)\s+blocked\b/i.test(notes)) return true;
  if (/^blocked\b/im.test(notes)) return true;
  return false;
}

export function isReleasedOrDone(status: string | null): boolean {
  if (!status) return false;
  return DONE_RE.test(status) && !CLAIMED_RE.test(status.replace(DONE_RE, ""));
}

export function isActivelyClaimed(status: string | null): boolean {
  if (!status) return false;
  if (isReleasedOrDone(status)) return false;
  return CLAIMED_RE.test(status) || /\bin progress\b/i.test(status);
}

export type HealthInput = {
  lock: LockRecord | null;
  /** Latest activity from lock timestamps or matching git commits */
  lastActivityAt: string | null;
  now?: number;
};

export type HealthResult = { health: Health; reason: string };

/**
 * Health rule:
 * - idle: no lock
 * - green/healthy: claimed with recent activity <30 min, OR done/released
 * - amber/stalled: claimed but no lock/commit activity >30 min
 * - red/blocked: notes/status mention blocked/error/404/unauthorized, or explicit blocked status
 */
export function classifyHealth(input: HealthInput): HealthResult {
  const now = input.now ?? Date.now();
  const lock = input.lock;
  if (!lock) {
    return { health: "idle", reason: "No lock file mapped to this bot." };
  }

  if (textLooksBlocked(lock.status, lock.notes) || /\bblocked\b/i.test(lock.status ?? "")) {
    return { health: "blocked", reason: "Lock status/notes indicate blocked or error." };
  }

  if (isReleasedOrDone(lock.status)) {
    return { health: "healthy", reason: "Lock is done/released." };
  }

  if (/^idle\b/i.test((lock.status ?? "").trim())) {
    return { health: "idle", reason: "Lock explicitly idle." };
  }

  const activityIso =
    input.lastActivityAt ||
    lock.released_at ||
    lock.claimed_at ||
    null;
  const activityMs = parseTimeMs(activityIso, now);
  const claimed = isActivelyClaimed(lock.status) || Boolean(lock.claimed_at && !lock.released_at);

  if (claimed) {
    if (activityMs == null) {
      return { health: "stalled", reason: "Claimed but activity timestamp missing." };
    }
    const age = now - activityMs;
    if (age <= STALL_MS) {
      return { health: "healthy", reason: "Claimed with recent activity (<30 min)." };
    }
    return { health: "stalled", reason: `Claimed but no activity for ${Math.round(age / 60000)} min.` };
  }

  // Unknown status with a lock — treat as idle-ish stalled if old, else healthy if recent
  if (activityMs != null && now - activityMs <= STALL_MS) {
    return { health: "healthy", reason: "Recent lock activity." };
  }
  if (activityMs != null) {
    return { health: "stalled", reason: "Lock present but activity older than 30 min." };
  }
  return { health: "idle", reason: "Lock present without clear claim/activity." };
}
