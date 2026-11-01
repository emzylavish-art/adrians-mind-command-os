/**
 * Queue #10 — Forever-contract guard (pure / client-safe).
 * Queue-health tone, lane-idle "needs next task", never invents queue rows.
 * Hacker: sanitize titles, cap lists, harden bad timestamps.
 */
import { parseTimeMs, sanitizeLabelText, STALL_MS } from "./health.ts";
import type { BotNode } from "./types.ts";
import type { QueueItem } from "./queue-parse.ts";
import { queueHead } from "./queue-parse.ts";

export const IDLE_NEEDS_TASK_MS = STALL_MS; // 30 min
export const MAX_IDLE_ROWS = 40;
export const MAX_QUEUED_SHOWN = 24;

export type QueueHealthTone = "green" | "amber" | "red" | "unknown";

export type LaneIdleRow = {
  botId: string;
  botName: string;
  reason: string;
  idleMs: number | null;
  marker: "needs next task";
};

export type ForeverContractGuard = {
  tone: QueueHealthTone;
  /** false when the queue file could not be read — never shown as a red breach. */
  sourceAvailable: boolean;
  queuedCount: number;
  activeCount: number;
  doneCount: number;
  label: string;
  summary: string;
  head: QueueItem | null;
  queued: QueueItem[];
  needsNextTask: LaneIdleRow[];
  needsNextCount: number;
};

/** green ≥3 queued, amber 1–2, red empty. */
export function queueHealthTone(queuedCount: number): QueueHealthTone {
  const n = Number.isFinite(queuedCount) ? Math.max(0, Math.floor(queuedCount)) : 0;
  if (n >= 3) return "green";
  if (n >= 1) return "amber";
  return "red";
}

export function sanitizeQueueTitle(raw: string, max = 96): string {
  return sanitizeLabelText(
    String(raw ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/javascript:/gi, "")
      .replace(/on\w+=/gi, ""),
    max,
  );
}

function isReleasedOrExplicitIdle(bot: BotNode): boolean {
  const lock = bot.lock;
  if (!lock) return bot.health === "idle";
  if (lock.released_at) return true;
  const st = (lock.status ?? "").trim();
  if (/^(done|released|complete|completed|idle)\b/i.test(st)) return true;
  if (/released:\s*true/i.test(lock.notes || "")) return true;
  // paused fleet lanes with no active claim
  if (/^paused\b/i.test(st) && !lock.claimed_at) return true;
  if (bot.health === "idle") return true;
  return false;
}

/**
 * Released/idle >30m with no recent commit/activity → needs next task.
 * Actively claimed bots never get the marker.
 */
export function detectLaneIdle(
  bot: BotNode,
  nowMs: number,
  idleMs = IDLE_NEEDS_TASK_MS,
): LaneIdleRow | null {
  const lock = bot.lock;
  const claimed =
    lock &&
    !lock.released_at &&
    /^(claimed|in\s*progress|active|working)\b/i.test((lock.status ?? "").trim());
  if (claimed) return null;
  if (!isReleasedOrExplicitIdle(bot) && bot.health !== "idle" && bot.health !== "stalled") {
    // healthy released-done without age still check timestamps below
    if (!(lock?.released_at || bot.health === "healthy")) return null;
  }

  const activityIso =
    bot.lastActivityAt || lock?.released_at || lock?.claimed_at || null;
  const activityMs = parseTimeMs(activityIso, nowMs);
  // "no new commit" — lock.commits empty or we only have stale activity
  const hasRecentCommitHint =
    Array.isArray(bot.commits) &&
    bot.commits.length > 0 &&
    activityMs != null &&
    nowMs - activityMs <= idleMs;

  if (hasRecentCommitHint && !lock?.released_at) return null;

  if (activityMs == null) {
    // no timestamp: still mark idle/released lanes so the queue doesn't go blind
    if (bot.health === "idle" || lock?.released_at || isReleasedOrExplicitIdle(bot)) {
      return {
        botId: bot.id,
        botName: sanitizeQueueTitle(bot.name, 64),
        reason: "Released/idle with no activity timestamp — needs next task.",
        idleMs: null,
        marker: "needs next task",
      };
    }
    return null;
  }

  const age = nowMs - activityMs;
  if (!Number.isFinite(age) || age < 0) return null;
  if (age <= idleMs) return null;

  return {
    botId: bot.id,
    botName: sanitizeQueueTitle(bot.name, 64),
    reason: `Idle/released ${Math.round(age / 60000)} min with no new commit.`,
    idleMs: age,
    marker: "needs next task",
  };
}

export function buildForeverContractGuard(input: {
  queue?: readonly QueueItem[] | null;
  bots?: readonly BotNode[] | null;
  nowMs?: number;
  idleMs?: number;
  /** Where the queue was read from; "unavailable"/empty ⇒ honest unknown state. */
  queueSource?: string | null;
}): ForeverContractGuard {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const idleMs = Number.isFinite(input.idleMs) ? (input.idleMs as number) : IDLE_NEEDS_TASK_MS;
  const raw = Array.isArray(input.queue) ? input.queue : [];
  const queuedAll = raw.filter((i) => i.status === "queued");
  const activeCount = raw.filter((i) => i.status === "active").length;
  const doneCount = raw.filter((i) => i.status === "done").length;
  const queuedCount = queuedAll.length;
  const sourceAvailable =
    input.queueSource === undefined
      ? true
      : typeof input.queueSource === "string" &&
        input.queueSource.trim() !== "" &&
        input.queueSource !== "unavailable";
  const tone: QueueHealthTone = sourceAvailable ? queueHealthTone(queuedCount) : "unknown";

  const queued = queuedAll.slice(0, MAX_QUEUED_SHOWN).map((q) => ({
    ...q,
    title: sanitizeQueueTitle(q.title),
    detail: sanitizeQueueTitle(q.detail, 160),
  }));

  const headRaw = queueHead(raw as QueueItem[]);
  const head = headRaw
    ? {
        ...headRaw,
        title: sanitizeQueueTitle(headRaw.title),
        detail: sanitizeQueueTitle(headRaw.detail, 160),
      }
    : null;

  const bots = Array.isArray(input.bots) ? input.bots : [];
  const needs: LaneIdleRow[] = [];
  for (const bot of bots) {
    if (needs.length >= MAX_IDLE_ROWS) break;
    const row = detectLaneIdle(bot, nowMs, idleMs);
    if (row) needs.push(row);
  }

  const label =
    tone === "unknown"
      ? "Queue source unavailable"
      : tone === "green"
        ? "Queue healthy"
        : tone === "amber"
          ? "Queue thin"
          : "Queue empty";
  const summary =
    tone === "unknown"
      ? "DASHBOARD_QUEUE.md not readable on this host — queue health unknown (not a breach)"
      : tone === "green"
      ? `${queuedCount} queued · contract fed`
      : tone === "amber"
        ? `${queuedCount} queued · append next research soon`
        : "0 queued · forever-contract breach — append researched upgrades";

  return {
    tone,
    sourceAvailable,
    queuedCount,
    activeCount,
    doneCount,
    label,
    summary,
    head,
    queued,
    needsNextTask: needs,
    needsNextCount: needs.length,
  };
}
