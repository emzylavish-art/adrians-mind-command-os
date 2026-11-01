/**
 * Dashboard real-data chart series (Zack charts pass).
 * Pure — no fs. Missing inputs → empty series + "no source yet".
 * Hacker: NaN/neg counts dropped; hour buckets capped; never invents points.
 */
import type { GitCommit, Health } from "./types.ts";
import type { BotNode } from "./types.ts";
import type { Timeline, TimelineEvent } from "./time-scrub.ts";
import type { FleetLandingStatus } from "./landing-status.ts";
import type { MoneyView } from "./spend-core.ts";
import { parseTimeMs } from "./health.ts";

export const NO_CHART_SOURCE = "no source yet";
export const MAX_BOTS = 18;
export const MAX_HOURS = 24;
export const MAX_HEALTH_BUCKETS = 24;

export type ChartPoint = { label: string; value: number };
export type ChartSeries = {
  id: string;
  title: string;
  unit: string;
  points: ChartPoint[];
  source: string;
  emptyReason: string | null;
};

export type DashboardCharts = {
  commitsPerBotHour: ChartSeries;
  commitsPerDay: ChartSeries;
  botHealth: ChartSeries;
  lockHealthShare: ChartSeries;
  landingsPerLane: ChartSeries;
  spend: ChartSeries;
  generatedAtMs: number;
};

function finiteNonNeg(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n > 1e9) return null;
  return n;
}

function watHourKey(ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")}/${get("month")} ${get("hour")}h`;
  } catch {
    return new Date(ms).toISOString().slice(5, 13);
  }
}

function botFromBranch(branch: string): string {
  const b = branch.replace(/^origin\//, "");
  if (/dashboard-3d-visual-painter|visual-painter/.test(b)) return "cosmos-painter";
  if (/dashboard-3d-visual-light|visual-light/.test(b)) return "cosmos-light";
  if (/dashboard-3d-visual-motion|visual-motion/.test(b)) return "cosmos-motion";
  if (/^dashboard-3d$/.test(b)) return "dashboard";
  if (/voice-wiring/.test(b)) return "voice-wiring";
  if (/voice-integration/.test(b)) return "voice-integration";
  if (/media-integration/.test(b)) return "media-integration";
  if (/mcp-integration/.test(b)) return "mcp-integration";
  if (/error-banners/.test(b)) return "error-banners";
  if (/visual-polish|visual\//.test(b)) return "visual-polish";
  if (/logic/.test(b)) return "logic";
  if (/merge-gate/.test(b)) return "merge-gate";
  if (/rea|feature-hunter/.test(b)) return "rea-feature-hunter";
  if (/gap/.test(b)) return "gap-dispatcher";
  if (/conductor/.test(b)) return "conductor";
  if (/xai/.test(b)) return "xai-verification";
  if (/hp-pairing|pc-pairing/.test(b)) return "hp-pairing";
  if (/integration|preview/.test(b)) return "grok-build";
  return b.slice(0, 18) || "unknown";
}

/** Commits per bot (branch-mapped), optionally scoped to last N hours. */
export function buildCommitsPerBotHour(
  commits: readonly GitCommit[] | null | undefined,
  nowMs = Date.now(),
  windowHours = 12,
): ChartSeries {
  const title = "Commits / bot (recent)";
  if (!commits || !commits.length) {
    return {
      id: "commits-per-bot",
      title,
      unit: "commits",
      points: [],
      source: NO_CHART_SOURCE,
      emptyReason: NO_CHART_SOURCE,
    };
  }
  const windowMs = Math.max(1, windowHours) * 3600_000;
  const counts = new Map<string, number>();
  let used = 0;
  for (const c of commits) {
    const at = parseTimeMs(c.date, nowMs);
    if (at == null) continue;
    if (nowMs - at > windowMs) continue;
    const bot = botFromBranch(c.branch || "unknown");
    counts.set(bot, (counts.get(bot) ?? 0) + 1);
    used += 1;
  }
  if (!used) {
    return {
      id: "commits-per-bot",
      title,
      unit: "commits",
      points: [],
      source: "git",
      emptyReason: NO_CHART_SOURCE,
    };
  }
  const points = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((p) => finiteNonNeg(p.value) != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BOTS);
  return {
    id: "commits-per-bot",
    title,
    unit: "commits",
    points,
    source: "git commits",
    emptyReason: points.length ? null : NO_CHART_SOURCE,
  };
}

/**
 * Lock-health share over time from timeline lock events.
 * Buckets by WAT hour; value = active claims (claim without later release in bucket window).
 * Honest: we chart claim vs release counts per hour (not invented health %).
 */
export function buildLockHealthShare(
  timeline: Timeline | null | undefined,
  nowMs = Date.now(),
): ChartSeries {
  const title = "Lock claims vs releases / hour";
  const events: TimelineEvent[] = timeline?.events ?? [];
  const lockEv = events.filter((e) => e.kind === "lock_claim" || e.kind === "lock_release");
  if (!lockEv.length) {
    return {
      id: "lock-health-share",
      title,
      unit: "events",
      points: [],
      source: timeline ? "timeline" : NO_CHART_SOURCE,
      emptyReason: NO_CHART_SOURCE,
    };
  }
  // paired points: for each hour, net = claims - releases (clamped >=0) as "active pressure"
  const byHour = new Map<string, { claims: number; releases: number; order: number }>();
  for (const e of lockEv) {
    if (!Number.isFinite(e.atMs)) continue;
    if (nowMs - e.atMs > MAX_HEALTH_BUCKETS * 3600_000) continue;
    const key = watHourKey(e.atMs);
    const row = byHour.get(key) ?? { claims: 0, releases: 0, order: e.atMs };
    if (e.kind === "lock_claim") row.claims += 1;
    else row.releases += 1;
    row.order = Math.min(row.order, e.atMs);
    byHour.set(key, row);
  }
  const points = [...byHour.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .slice(-MAX_HOURS)
    .map(([label, row]) => {
      const net = Math.max(0, row.claims); // real claim count that hour
      return { label: `${label} ·c${row.claims}/r${row.releases}`, value: net };
    })
    .filter((p) => finiteNonNeg(p.value) != null);
  return {
    id: "lock-health-share",
    title,
    unit: "claims",
    points,
    source: "timeline lock events",
    emptyReason: points.length ? null : NO_CHART_SOURCE,
  };
}

export function buildLandingsPerLane(
  landings: readonly FleetLandingStatus[] | null | undefined,
): ChartSeries {
  const title = "Landings / lane";
  if (!landings || !landings.length) {
    return {
      id: "landings-per-lane",
      title,
      unit: "hops",
      points: [],
      source: NO_CHART_SOURCE,
      emptyReason: NO_CHART_SOURCE,
    };
  }
  const points = landings.map((L) => {
    const reached = L.hops.filter((h) => h.reached).length;
    const v = finiteNonNeg(reached) ?? 0;
    return {
      label: `${L.lane}${L.mergedIntoDashboard3d ? "✓" : ""}`,
      value: v,
    };
  });
  return {
    id: "landings-per-lane",
    title,
    unit: "hops reached",
    points,
    source: "fleet landings",
    emptyReason: null,
  };
}

export function buildSpendSeries(money: MoneyView | null | undefined): ChartSeries {
  const title = "Spend (USD)";
  if (!money || !money.available) {
    return {
      id: "spend",
      title,
      unit: "USD",
      points: [],
      source: money?.reason || NO_CHART_SOURCE,
      emptyReason: money?.reason || NO_CHART_SOURCE,
    };
  }
  const points: ChartPoint[] = [];
  if (money.todayTotalUsd != null && finiteNonNeg(money.todayTotalUsd) != null) {
    points.push({ label: "today", value: money.todayTotalUsd });
  }
  if (money.burnPerHourUsd != null && finiteNonNeg(money.burnPerHourUsd) != null) {
    points.push({ label: "burn/hr", value: money.burnPerHourUsd });
  }
  return {
    id: "spend",
    title,
    unit: "USD",
    points,
    source: money.source || "spend adapter",
    emptyReason: points.length ? null : NO_CHART_SOURCE,
  };
}


/** Bots counted by current health state (real status payload only). */
export function buildBotHealthCounts(bots: readonly BotNode[] | null | undefined): ChartSeries {
  const title = "Bot health (count)";
  if (!bots || !bots.length) {
    return {
      id: "bot-health",
      title,
      unit: "bots",
      points: [],
      source: NO_CHART_SOURCE,
      emptyReason: NO_CHART_SOURCE,
    };
  }
  const order: Health[] = ["healthy", "stalled", "blocked", "idle"];
  const counts = new Map<string, number>();
  for (const b of bots) {
    const h = (b.health || "idle") as string;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const points: ChartPoint[] = [];
  for (const h of order) {
    const value = counts.get(h) ?? 0;
    if (finiteNonNeg(value) != null && value > 0) points.push({ label: h, value });
  }
  // Include any unexpected health labels honestly
  for (const [label, value] of counts) {
    if (!(order as readonly string[]).includes(label) && finiteNonNeg(value) != null && value > 0) {
      points.push({ label, value });
    }
  }
  return {
    id: "bot-health",
    title,
    unit: "bots",
    points,
    source: "status.bots health",
    emptyReason: points.length ? null : NO_CHART_SOURCE,
  };
}

/** Commits per WAT calendar day from real git (or snapshot) log. */
export function buildCommitsPerDay(
  commits: readonly GitCommit[] | null | undefined,
  nowMs = Date.now(),
  maxDays = 14,
): ChartSeries {
  const title = "Commits / day";
  if (!commits || !commits.length) {
    return {
      id: "commits-per-day",
      title,
      unit: "commits",
      points: [],
      source: NO_CHART_SOURCE,
      emptyReason: NO_CHART_SOURCE,
    };
  }
  const byDay = new Map<string, { value: number; order: number }>();
  let used = 0;
  for (const c of commits) {
    const at = parseTimeMs(c.date, nowMs);
    if (at == null) continue;
    if (nowMs - at > maxDays * 86400_000) continue;
    let key = "";
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(at));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      key = `${get("day")}/${get("month")}`;
    } catch {
      key = new Date(at).toISOString().slice(5, 10);
    }
    const row = byDay.get(key) ?? { value: 0, order: at };
    row.value += 1;
    row.order = Math.min(row.order, at);
    byDay.set(key, row);
    used += 1;
  }
  if (!used) {
    return {
      id: "commits-per-day",
      title,
      unit: "commits",
      points: [],
      source: "git",
      emptyReason: NO_CHART_SOURCE,
    };
  }
  const points = [...byDay.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([label, row]) => ({ label, value: row.value }))
    .filter((p) => finiteNonNeg(p.value) != null);
  return {
    id: "commits-per-day",
    title,
    unit: "commits",
    points,
    source: "git commits (WAT day)",
    emptyReason: points.length ? null : NO_CHART_SOURCE,
  };
}

export function buildDashboardCharts(input: {
  commits?: readonly GitCommit[] | null;
  timeline?: Timeline | null;
  landings?: readonly FleetLandingStatus[] | null;
  money?: MoneyView | null;
  bots?: readonly BotNode[] | null;
  nowMs?: number;
}): DashboardCharts {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  return {
    commitsPerBotHour: buildCommitsPerBotHour(input.commits, nowMs),
    commitsPerDay: buildCommitsPerDay(input.commits, nowMs),
    botHealth: buildBotHealthCounts(input.bots),
    lockHealthShare: buildLockHealthShare(input.timeline, nowMs),
    landingsPerLane: buildLandingsPerLane(input.landings),
    spend: buildSpendSeries(input.money),
    generatedAtMs: nowMs,
  };
}
