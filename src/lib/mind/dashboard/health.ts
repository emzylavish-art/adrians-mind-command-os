import type { Health, LockRecord } from "./types.ts";

const DONE_RE = /\b(done|released|complete|completed)\b/i;
const CLAIMED_RE = /\b(claimed|in\s*progress|active|working)\b/i;

export const STALL_MS = 30 * 60 * 1000;

export function parseTimeMs(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const cleaned = value.replace(/\s*\(Africa\/Lagos\)\s*$/i, "").trim();
  const ms = Date.parse(cleaned);
  if (Number.isFinite(ms)) return ms;
  const fallback = Date.parse(cleaned.replace(" ", "T"));
  return Number.isFinite(fallback) ? fallback : null;
}

/**
 * Notes alone must NOT paint a lane red. Problem words in notes (404, Unauthorized,
 * BLOCKED: cycle stopped by rate limits, etc.) are diagnostic — only an active
 * status of blocked/error without release means blocked.
 */
export function textLooksBlocked(status: string | null, _notes: string): boolean {
  const s = (status ?? "").trim();
  if (!s) return false;
  if (DONE_RE.test(s) && !/\bblocked\b/i.test(s)) return false;
  return /^(blocked|error)\b/i.test(s) || /\bstatus:\s*(blocked|error)\b/i.test(s);
}

export function isReleasedOrDone(status: string | null): boolean {
  if (!status) return false;
  return DONE_RE.test(status) && !CLAIMED_RE.test(status.replace(DONE_RE, ""));
}

export function isActivelyClaimed(status: string | null): boolean {
  if (!status) return false;
  if (isReleasedOrDone(status)) return false;
  if (/^(blocked|error)\b/i.test(status.trim())) return false;
  return CLAIMED_RE.test(status) || /\bin progress\b/i.test(status);
}

export type HealthInput = {
  lock: LockRecord | null;
  lastActivityAt: string | null;
  now?: number;
};

export type HealthResult = { health: Health; reason: string };

export function classifyHealth(input: HealthInput): HealthResult {
  const now = input.now ?? Date.now();
  const lock = input.lock;
  if (!lock) {
    return { health: "idle", reason: "No lock file mapped to this bot." };
  }

  const statusBlocked = textLooksBlocked(lock.status, lock.notes);
  if (statusBlocked) {
    // Released+blocked = cycle ended (e.g. rate-limit stop), not an active red failure.
    if (lock.released_at) {
      return {
        health: "stalled",
        reason: "Status blocked but lock released — cycle ended; not an active block.",
      };
    }
    return { health: "blocked", reason: "Lock status is actively blocked/error." };
  }

  if (isReleasedOrDone(lock.status)) {
    return { health: "healthy", reason: "Lock is done/released." };
  }

  if (/^idle\b/i.test((lock.status ?? "").trim())) {
    return { health: "idle", reason: "Lock explicitly idle." };
  }

  const activityIso = input.lastActivityAt || lock.released_at || lock.claimed_at || null;
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

  if (activityMs != null && now - activityMs <= STALL_MS) {
    return { health: "healthy", reason: "Recent lock activity." };
  }
  if (activityMs != null) {
    return { health: "stalled", reason: "Lock present but activity older than 30 min." };
  }
  return { health: "idle", reason: "Lock present without clear claim/activity." };
}

/** Strip control chars for CSS2D / DOM labels (textContent-safe extra hardening). */
export function sanitizeLabelText(raw: string, max = 80): string {
  return raw.replace(/[\u0000-\u001F\u007F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
