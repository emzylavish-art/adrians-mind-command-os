/**
 * Queue #5 — TIME scrubber (Dashboard Bot).
 *
 * Replays **real** history only: git commits on dashboard-3d + fleet branches,
 * plus lock claimed_at / released_at / heartbeat_at (and optional transition log).
 * Never interpolates fake health. Scrubbing before the earliest event returns
 * "no history before X" and idle stars.
 *
 * Hacker: caps huge timelines, drops invalid dates, clamps/drops far-future
 * timestamps (clock skew), refuses NaN scrub positions.
 */
import { classifyHealth, parseTimeMs } from "./health.ts";
import type { DashboardBotId, GitCommit, Health, LockRecord } from "./types.ts";

export const MAX_TIMELINE_EVENTS = 2000;
/** Allow small NTP skew; anything farther in the future is dropped (counted). */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const TIMELINE_BRANCHES = [
  "dashboard-3d",
  "dashboard-3d-visual-painter",
  "dashboard-3d-visual-light",
  "dashboard-3d-visual-motion",
] as const;

const BRANCH_BOT: Record<string, DashboardBotId> = {
  "dashboard-3d": "dashboard",
  "dashboard-3d-visual-painter": "cosmos-painter",
  "dashboard-3d-visual-light": "cosmos-light",
  "dashboard-3d-visual-motion": "cosmos-motion",
};

export type TimelineEventKind = "commit" | "lock_claim" | "lock_release" | "lock_heartbeat";

export type TimelineEvent = {
  atMs: number;
  atIso: string;
  kind: TimelineEventKind;
  botId: DashboardBotId | null;
  branch?: string;
  sha?: string;
  subject?: string;
  lockFile?: string;
  label: string;
};

export type Timeline = {
  events: TimelineEvent[];
  earliestMs: number | null;
  latestMs: number | null;
  droppedFuture: number;
  droppedInvalid: number;
  truncated: boolean;
};

export type ScrubMode = "live" | "scrub" | "before_history";

export type ScrubBotHealth = { health: Health; reason: string };

export type ScrubResult = {
  mode: ScrubMode;
  scrubMs: number;
  /** Human message; set for before_history (and optional scrub hints). */
  message: string | null;
  botHealth: Record<string, ScrubBotHealth>;
  /** Index of last event at-or-before scrub (or -1). */
  eventIndex: number;
};

export type LockTransitionLogLine = {
  atIso: string;
  action: string;
  owner: string;
  note: string;
  lockFile?: string;
};

function botForBranch(branch: string | null | undefined): DashboardBotId | null {
  if (!branch) return null;
  const short = branch.replace(/^origin\//, "");
  return BRANCH_BOT[short] ?? null;
}

function botForLockFile(file: string): DashboardBotId | null {
  const f = file.replace(/^.*\//, "");
  if (/^dashboard-3d\.lock$/i.test(f)) return "dashboard";
  if (/visual-painter/i.test(f)) return "cosmos-painter";
  if (/visual-light/i.test(f)) return "cosmos-light";
  if (/visual-motion/i.test(f)) return "cosmos-motion";
  return null;
}

/** Format ms as Africa/Lagos wall clock for UI messages. */
export function formatWat(ms: number): string {
  try {
    return (
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(ms)) + " WAT"
    );
  } catch {
    return new Date(ms).toISOString();
  }
}

export function parseLockTransitionLog(text: string): LockTransitionLogLine[] {
  const out: LockTransitionLogLine[] = [];
  if (!text) return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // atIso \t action \t owner \t note  OR atIso|action|owner|note
    const parts = line.includes("\t") ? line.split("\t") : line.split("|");
    if (parts.length < 2) continue;
    const atIso = (parts[0] ?? "").trim();
    const action = (parts[1] ?? "").trim().toLowerCase();
    const owner = (parts[2] ?? "").trim();
    const note = parts.slice(3).join("\t").trim();
    if (!atIso || !action) continue;
    out.push({ atIso, action, owner, note });
  }
  return out;
}

export type BuildTimelineInput = {
  commits?: readonly GitCommit[];
  locks?: readonly LockRecord[];
  transitions?: readonly LockTransitionLogLine[];
  /** Override "now" for tests. */
  nowMs?: number;
  maxEvents?: number;
  maxFutureSkewMs?: number;
};

/**
 * Build a sorted, capped timeline from real sources only.
 * Far-future timestamps (beyond now + skew) are dropped, not clamped into the past.
 */
export function buildTimeline(input: BuildTimelineInput): Timeline {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const maxEvents = Math.min(
    MAX_TIMELINE_EVENTS,
    Math.max(1, Math.floor(input.maxEvents ?? MAX_TIMELINE_EVENTS)),
  );
  const skew = Number.isFinite(input.maxFutureSkewMs)
    ? Math.max(0, input.maxFutureSkewMs as number)
    : MAX_FUTURE_SKEW_MS;
  const futureLimit = nowMs + skew;

  const raw: TimelineEvent[] = [];
  let droppedInvalid = 0;
  let droppedFuture = 0;

  const push = (ev: Omit<TimelineEvent, "atMs"> & { atMs: number | null }) => {
    if (ev.atMs == null || !Number.isFinite(ev.atMs)) {
      droppedInvalid += 1;
      return;
    }
    if (ev.atMs > futureLimit) {
      droppedFuture += 1;
      return;
    }
    raw.push({ ...ev, atMs: ev.atMs });
  };

  for (const c of input.commits ?? []) {
    const atMs = parseTimeMs(c.date, nowMs);
    const botId = botForBranch(c.branch);
    push({
      atMs,
      atIso: c.date || "",
      kind: "commit",
      botId,
      branch: c.branch,
      sha: c.sha,
      subject: c.subject,
      label: `${(c.sha ?? "").slice(0, 7)} ${c.subject ?? ""}`.trim(),
    });
  }

  for (const lock of input.locks ?? []) {
    const botId = botForLockFile(lock.file) ?? botForBranch(lock.branch);
    // Gap#35: prefer promoted heartbeatAt; raw may be omitted after publicize
    const hb = lock.heartbeatAt ?? lock.raw?.heartbeat_at ?? lock.raw?.heartbeat ?? null;
    if (lock.claimed_at) {
      push({
        atMs: parseTimeMs(lock.claimed_at, nowMs),
        atIso: lock.claimed_at,
        kind: "lock_claim",
        botId,
        branch: lock.branch ?? undefined,
        lockFile: lock.file,
        label: `claim ${lock.file}${lock.owner ? ` · ${lock.owner}` : ""}`,
      });
    }
    if (hb) {
      push({
        atMs: parseTimeMs(hb, nowMs),
        atIso: hb,
        kind: "lock_heartbeat",
        botId,
        branch: lock.branch ?? undefined,
        lockFile: lock.file,
        label: `heartbeat ${lock.file}`,
      });
    }
    if (lock.released_at) {
      push({
        atMs: parseTimeMs(lock.released_at, nowMs),
        atIso: lock.released_at,
        kind: "lock_release",
        botId,
        branch: lock.branch ?? undefined,
        lockFile: lock.file,
        label: `release ${lock.file}`,
      });
    }
  }

  for (const tr of input.transitions ?? []) {
    const atMs = parseTimeMs(tr.atIso, nowMs);
    const action = tr.action;
    let kind: TimelineEventKind | null = null;
    if (/claim/.test(action)) kind = "lock_claim";
    else if (/release/.test(action)) kind = "lock_release";
    else if (/heartbeat|hb/.test(action)) kind = "lock_heartbeat";
    if (!kind) continue;
    const lockFile = tr.lockFile ?? "dashboard-3d.lock";
    push({
      atMs,
      atIso: tr.atIso,
      kind,
      botId: botForLockFile(lockFile),
      lockFile,
      label: `${action} ${tr.owner || ""} ${tr.note || ""}`.trim(),
    });
  }

  raw.sort((a, b) => a.atMs - b.atMs || a.label.localeCompare(b.label));

  let truncated = false;
  let events = raw;
  if (events.length > maxEvents) {
    truncated = true;
    // Keep the most recent window (hacker: 10k → last maxEvents)
    events = events.slice(events.length - maxEvents);
  }

  return {
    events,
    earliestMs: events.length ? events[0]!.atMs : null,
    latestMs: events.length ? events[events.length - 1]!.atMs : null,
    droppedFuture,
    droppedInvalid,
    truncated,
  };
}

function emptyHealthMap(botIds: readonly string[], reason: string): Record<string, ScrubBotHealth> {
  const out: Record<string, ScrubBotHealth> = {};
  for (const id of botIds) out[id] = { health: "idle", reason };
  return out;
}

export type ScrubInput = {
  timeline: Timeline;
  /** Bot ids to report (usually live status bots). */
  botIds: readonly string[];
  /** Live health snapshot used when mode === live. */
  liveHealth?: Record<string, ScrubBotHealth>;
  scrubMs: number;
  nowMs?: number;
  /** Treat scrub within this ms of now as Live. */
  liveEpsilonMs?: number;
};

/**
 * Resolve bot health at scrubMs from observed events only.
 * No synthetic midpoints: lock state is the last claim/release/heartbeat ≤ T;
 * activity is the last commit/heartbeat ≤ T.
 */
export function scrubAt(input: ScrubInput): ScrubResult {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const eps = Number.isFinite(input.liveEpsilonMs) ? Math.max(0, input.liveEpsilonMs as number) : 1500;
  let scrubMs = input.scrubMs;
  if (!Number.isFinite(scrubMs)) scrubMs = nowMs;
  scrubMs = Math.min(scrubMs, nowMs); // never scrub into the future

  const { timeline, botIds } = input;
  const earliest = timeline.earliestMs;

  if (scrubMs >= nowMs - eps) {
    const botHealth =
      input.liveHealth ??
      emptyHealthMap(botIds, "Live.");
    return { mode: "live", scrubMs: nowMs, message: null, botHealth, eventIndex: timeline.events.length - 1 };
  }

  if (earliest == null || scrubMs < earliest) {
    const when = earliest != null ? formatWat(earliest) : "any recorded event";
    const message = `no history before ${when}`;
    return {
      mode: "before_history",
      scrubMs,
      message,
      botHealth: emptyHealthMap(botIds, message),
      eventIndex: -1,
    };
  }

  // Last event index ≤ scrubMs
  let eventIndex = -1;
  for (let i = 0; i < timeline.events.length; i++) {
    if (timeline.events[i]!.atMs <= scrubMs) eventIndex = i;
    else break;
  }

  type Acc = {
    claimedAt: string | null;
    releasedAt: string | null;
    heartbeatAt: string | null;
    status: string | null;
    branch: string | null;
    lockFile: string | null;
    lastCommitAt: string | null;
  };
  const acc = new Map<string, Acc>();
  const ensure = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        claimedAt: null,
        releasedAt: null,
        heartbeatAt: null,
        status: null,
        branch: null,
        lockFile: null,
        lastCommitAt: null,
      };
      acc.set(id, a);
    }
    return a;
  };

  for (let i = 0; i <= eventIndex; i++) {
    const ev = timeline.events[i]!;
    if (!ev.botId) continue;
    const a = ensure(ev.botId);
    if (ev.branch) a.branch = ev.branch;
    if (ev.lockFile) a.lockFile = ev.lockFile;
    if (ev.kind === "commit") {
      a.lastCommitAt = ev.atIso || new Date(ev.atMs).toISOString();
    } else if (ev.kind === "lock_claim") {
      a.claimedAt = ev.atIso;
      a.releasedAt = null;
      a.status = "claimed";
    } else if (ev.kind === "lock_release") {
      a.releasedAt = ev.atIso;
      a.status = "released";
    } else if (ev.kind === "lock_heartbeat") {
      a.heartbeatAt = ev.atIso;
      if (!a.status) a.status = "claimed";
    }
  }

  const botHealth: Record<string, ScrubBotHealth> = {};
  for (const id of botIds) {
    const a = acc.get(id);
    if (!a) {
      botHealth[id] = {
        health: "idle",
        reason: `No observed events for this bot at or before ${formatWat(scrubMs)}.`,
      };
      continue;
    }
    const lock: LockRecord | null = a.lockFile || a.claimedAt || a.releasedAt || a.heartbeatAt
      ? {
          file: a.lockFile ?? `${id}.lock`,
          owner: "",
          branch: a.branch,
          status: a.status,
          claimed_at: a.claimedAt,
          released_at: a.releasedAt,
          commits: [],
          notes: "",
          worktree: null,
          heartbeatAt: a.heartbeatAt ?? null,
          task: null,
          raw: a.heartbeatAt ? { heartbeat_at: a.heartbeatAt } : {},
        }
      : null;
    // Prefer the most recent observed activity (commit vs heartbeat) — never let an
    // older commit shadow a newer heartbeat (honest stall clock).
    const candidates = [a.lastCommitAt, a.heartbeatAt, a.releasedAt, a.claimedAt].filter(
      (x): x is string => Boolean(x),
    );
    let lastActivityAt: string | null = null;
    let best = -Infinity;
    for (const iso of candidates) {
      const ms = parseTimeMs(iso, scrubMs);
      if (ms != null && ms >= best && ms <= scrubMs) {
        best = ms;
        lastActivityAt = iso;
      }
    }
    if (!lock && !lastActivityAt) {
      botHealth[id] = {
        health: "idle",
        reason: `No observed events for this bot at or before ${formatWat(scrubMs)}.`,
      };
      continue;
    }
    // classifyHealth with now = scrubMs so stall windows are relative to scrubbed time
    const { health, reason } = classifyHealth({
      lock,
      lastActivityAt,
      now: scrubMs,
    });
    botHealth[id] = { health, reason: `At ${formatWat(scrubMs)}: ${reason}` };
  }

  return {
    mode: "scrub",
    scrubMs,
    message: null,
    botHealth,
    eventIndex,
  };
}

/** Clamp a slider ratio 0..1 onto the timeline span (or now if empty). */
export function scrubMsFromRatio(timeline: Timeline, ratio: number, nowMs = Date.now()): number {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  const earliest = timeline.earliestMs;
  if (earliest == null) return nowMs;
  const latest = Math.min(timeline.latestMs ?? nowMs, nowMs);
  if (latest <= earliest) return earliest;
  return earliest + r * (latest - earliest);
}

export function applyScrubToBots<T extends { id: string; health: Health; reason: string }>(
  bots: readonly T[],
  scrub: ScrubResult,
): T[] {
  if (scrub.mode === "live") return bots.slice() as T[];
  return bots.map((b) => {
    const hit = scrub.botHealth[b.id];
    if (!hit) return { ...b, health: "idle" as Health, reason: scrub.message ?? b.reason };
    return { ...b, health: hit.health, reason: hit.reason };
  });
}
