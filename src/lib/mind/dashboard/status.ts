import { DASHBOARD_BOTS } from "./bots.ts";
import { loadConductorNudges, loadGapDispatcherFeed, loadSpend, orchestratorFromLocks } from "./feeds.ts";
import { loadMoneyView } from "./spend.ts";
import { buildDashboardCharts } from "./chart-series.ts";
import { buildNotionMirrorView } from "./notion-mirror.ts";
import { collectBranchCommits, collectRecentCommitsResult, latestCommitActivityForBranch } from "./git.ts";
import { loadCommitsSnapshot } from "./commits-snapshot.ts";
import { buildTimeline, parseLockTransitionLog } from "./time-scrub.ts";
import { buildSkyFeed } from "./sky-feed.ts";
import { readFileSync, statSync } from "node:fs";
import { locksDirFromEnvSafe, repoDirFromEnvSafe } from "./safe-paths.ts";
import { classifyHealth } from "./health.ts";
import { readLocksDirResult } from "./locks.ts";

import { buildConstellations, constellationEdges, systemWeather } from "./constellations.ts";

import { buildProjectsDashboard } from "./projects.ts";
import { buildFleetPlan } from "./fleet-plan.ts";
import type { BotNode, DashboardStatus, LockRecord, TelemetryReceipt } from "./types.ts";

function pickPrimaryLock(locks: LockRecord[], fileRe: RegExp[], ownerRe: RegExp[]): LockRecord | null {
  const byFile = locks.filter((l) => fileRe.some((re) => re.test(l.file)));
  // Prefer non-gap / non-verifier locks when multiple match
  const ranked = [...byFile].sort((a, b) => {
    const score = (l: LockRecord) => {
      let s = 0;
      // Prefer the canonical lane lock (e.g. visual-polish.lock) over gap/aux locks.
      if (/^(visual-polish|logic-wiring|mcp-integration|media-integration|voice-integration|voice-wiring|error-banners|dashboard-3d|integration|rea-feature-hunter)\.lock$/i.test(l.file)) s += 8;
      if (/gap|verifier|hardening/i.test(l.file)) s -= 5;
      if (l.released_at && !/claimed|in progress/i.test(l.status ?? "")) s -= 1;
      if (l.claimed_at && !l.released_at) s += 3;
      if (/claimed|in progress/i.test(l.status ?? "")) s += 2;
      if (/done|released/i.test(l.status ?? "") && !/claimed/i.test(l.status ?? "")) s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  if (ranked[0]) return ranked[0];
  const byOwner = locks.filter((l) => ownerRe.some((re) => re.test(l.owner)));
  return byOwner[0] ?? null;
}

/** Each dependency can fail independently; these seams also permit offline fixtures. */
export const dashboardCollectors = {
  locks: readLocksDirResult,
  git: collectRecentCommitsResult,
  snapshot: loadCommitsSnapshot,
  conductor: loadConductorNudges,
  dispatcher: loadGapDispatcherFeed,
  spend: loadSpend,
  money: loadMoneyView,
  transitions: () => readFileSync("/workspace/audit/dashboard-3d/lock-transitions.log", "utf8"),
  branchCommits: collectBranchCommits,
  timeline: buildTimeline,
  constellations: buildConstellations,
  edges: constellationEdges,
  weather: systemWeather,
  fleetPlan: buildFleetPlan,
  skyFeed: buildSkyFeed,
  charts: buildDashboardCharts,
  mirror: buildNotionMirrorView,
  projects: buildProjectsDashboard,
  sourceUpdatedAt: (source: string): string | null => {
    try { return statSync(source).mtime.toISOString(); } catch { return null; }
  },
};

function emptyCharts(now: number, reason: string): DashboardStatus["charts"] {
  const series = (id: string, title: string, unit: string) => ({ id, title, unit, points: [], source: "unavailable", emptyReason: reason });
  return {
    commitsPerBotHour: series("commits-per-bot-hour", "Commits per bot / hour", "commits"),
    commitsPerDay: series("commits-per-day", "Commits per day", "commits"),
    botHealth: series("bot-health", "Development activity", "bots"),
    lockHealthShare: series("lock-health-share", "Development lock activity", "%"),
    landingsPerLane: series("landings-per-lane", "Landings per lane", "landings"),
    spend: series("spend", "Spend", "USD"),
    generatedAtMs: now,
  };
}

export async function buildDashboardStatus(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  overrides: Partial<typeof dashboardCollectors> = {},
): Promise<DashboardStatus> {
  const collectors = { ...dashboardCollectors, ...overrides };
  const generatedAt = new Date(now).toISOString();
  const telemetry: Record<string, TelemetryReceipt> = {};
  const record = (id: string, outcome: TelemetryReceipt["outcome"], basis: TelemetryReceipt["basis"], updatedAt: string | null = null, count: number | null = null, errorCode?: TelemetryReceipt["errorCode"]) => {
    const validDate = updatedAt && Number.isFinite(Date.parse(updatedAt)) && Date.parse(updatedAt) <= now + 60_000 ? updatedAt : null;
    telemetry[id] = { outcome, basis, collectedAt: generatedAt, updatedAt: validDate, count,
      freshness: basis === "private" ? "not_applicable" : basis === "snapshot" ? "historical" : !validDate ? "unknown" : now - Date.parse(validDate) > 24 * 60 * 60 * 1000 ? "historical" : "current",
      ...(errorCode ? { errorCode } : {}),
    };
  };
  const collect = <T,>(id: string, fn: () => T, fallback: T, basis: TelemetryReceipt["basis"] = "derived"): T => {
    try { const value = fn(); record(id, "available", basis); return value; }
    catch (error) {
      const missing = typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "EACCES");
      record(id, missing ? "unavailable" : "failed", basis, null, null, missing ? "unavailable" : "collection_failed"); return fallback;
    }
  };
  const stamp = (source: string) => {
    try { return source && source !== "unavailable" ? collectors.sourceUpdatedAt(source) : null; } catch { return null; }
  };
  const locksSafe = locksDirFromEnvSafe(env);
  const repoSafe = repoDirFromEnvSafe(env);
  const locksDir = locksSafe.path;
  const repoDir = repoSafe.path;
  const locksResult = collect("locks", () => collectors.locks(locksDir), { records: [], outcome: "unavailable" as const, updatedAt: null, rejected: 0 }, "live");
  const locks = locksResult.records;
  if (telemetry.locks.outcome === "available") record("locks", locksResult.outcome === "invalid" ? "failed" : locksResult.outcome, "live", locksResult.updatedAt, locks.length,
    locksResult.outcome === "invalid" ? "invalid_records" : locksResult.outcome === "partial" ? "partial_read" : locksResult.outcome === "unavailable" ? "unavailable" : undefined);

  let commits: DashboardStatus["commits"] = [];
  let gitOk = false;
  let commitsSource: "git" | "snapshot" | "none" = "none";
  let commitsSnapshotAt: string | undefined;
  const git = collect("git", () => collectors.git(repoDir, 40), { ok: false as const, commits: [], error: "Git collection failed" }, "live");
  gitOk = git.ok;
  if (gitOk) {
    commits = git.commits;
    commitsSource = "git";
    record("git", commits.length ? "available" : "empty", "live", generatedAt, commits.length);
  } else if (telemetry.git.outcome === "available") record("git", "unavailable", "live", null, 0, "unavailable");
  // A cached artifact never changes the outcome of live Git collection.
  if (!gitOk) {
    const snap = collect("commitsSnapshot", () => collectors.snapshot(), null, "snapshot");
    if (snap?.commits?.length) {
      commits = snap.commits.slice(0, 40);
      commitsSource = "snapshot";
      commitsSnapshotAt = snap.generatedAt && Number.isFinite(Date.parse(snap.generatedAt)) && Date.parse(snap.generatedAt) <= now ? snap.generatedAt : undefined;
      record("commitsSnapshot", "available", "snapshot", commitsSnapshotAt ?? null, commits.length);
    } else if (telemetry.commitsSnapshot.outcome === "available") record("commitsSnapshot", "unavailable", "snapshot", null, 0, "unavailable");
  }
  const bots: BotNode[] = DASHBOARD_BOTS.map((def) => {
    const lock = pickPrimaryLock(locks, def.lockMatchers, def.ownerMatchers);
    const branch = lock?.branch ?? null;
    const gitActivity = latestCommitActivityForBranch(commits, branch);
    const lastActivityAt = gitActivity || lock?.released_at || lock?.claimed_at || null;
    const { health, reason } = classifyHealth({ lock, lastActivityAt, now });
    return { id: def.id, name: def.name, health, lock, branch, lastActivityAt, commits: lock?.commits ?? [], notes: lock?.notes ?? "", reason,
      healthBasis: "development", runtimeHealth: "unverified" };
  });
  // Private accounts and their permission state are never inferred by this public feed.
  const notion = { available: false as const, reason: "Workspace data is private." };
  const notionGraph: DashboardStatus["notionGraph"] = {
    available: false, mode: "unavailable", reason: notion.reason,
    generatedAt: null, pages: [], edges: [], botPageMap: {}, stats: { pages: 0, edges: 0, botsMapped: 0 },
  };
  record("notion", "private", "private", null, null, "private_source");
  const conductor = collect("conductor", () => collectors.conductor("/workspace"), { source: "unavailable", nudges: [] }, "live");
  if (telemetry.conductor.outcome === "available") record("conductor", conductor.source === "unavailable" ? "unavailable" : conductor.nudges.length ? "available" : "empty", "live", stamp(conductor.source), conductor.nudges.length);
  const gapDispatcher = collect("gapDispatcher", () => collectors.dispatcher("/workspace/rea-captures"), { source: "unavailable", items: [] }, "live");
  if (telemetry.gapDispatcher.outcome === "available") record("gapDispatcher", gapDispatcher.source === "unavailable" ? "unavailable" : gapDispatcher.items.length ? "available" : "empty", "live", stamp(gapDispatcher.source), gapDispatcher.items.length);
  const orchestrator = orchestratorFromLocks(locks);
  const spend = collect("spend", () => collectors.spend(), { available: false as const, reason: "Spend collection failed." }, "live");
  if (telemetry.spend.outcome === "available") record("spend", spend.available ? "available" : "unavailable", "live");
  const money = collect("money", () => collectors.money({ nowMs: now }), { available: false, reason: "Spend collection failed.", source: null, currency: "USD" as const, todayTotalUsd: null, burnPerHourUsd: null, warnings: [], asOfMs: null, eventCount: 0, stale: false, droppedInvalid: 0, todayKey: null }, "live");
  if (telemetry.money.outcome === "available") record("money", money.available ? money.eventCount ? "available" : "empty" : "unavailable", "live", money.asOfMs != null ? new Date(money.asOfMs).toISOString() : null, money.eventCount);
  const constellations = collect("constellations", () => collectors.constellations(bots), []);
  const edges = collect("edges", () => collectors.edges(bots), []);
  const weather = collect("weather", () => collectors.weather(bots), { label: "Development activity unavailable", tone: "idle" as const, summary: "Runtime health has not been measured." });
  const transitionText = collect("transitions", () => collectors.transitions(), "", "live");
  if (telemetry.transitions.outcome === "available") record("transitions", transitionText ? "available" : "empty", "live", stamp("/workspace/audit/dashboard-3d/lock-transitions.log"));
  const branchCommits = collect("branchCommits", () => collectors.branchCommits(repoDir, undefined, 80), [], "live");
  if (telemetry.branchCommits.outcome === "available") record("branchCommits", branchCommits.length ? "available" : gitOk ? "empty" : "unavailable", "live", branchCommits.length || gitOk ? generatedAt : null, branchCommits.length);
  const timeline = collect("timeline", () => collectors.timeline({ commits: branchCommits.length ? branchCommits : commits, locks, transitions: parseLockTransitionLog(transitionText), nowMs: now }), { events: [], earliestMs: null, latestMs: null, droppedFuture: 0, droppedInvalid: 0, truncated: false });
  const base = {
    generatedAt, bots, commits, notion, conductor, gapDispatcher, orchestrator, spend,
    sources: { locksDir, repoDir, locksOk: locksResult.outcome === "available" || locksResult.outcome === "empty", gitOk, commitsSource,
      ...(commitsSnapshotAt ? { commitsSnapshotAt } : {}), ...(!gitOk ? { gitError: "Live Git collection unavailable." } : {}),
      ...(locksSafe.rejected ? { locksRejected: locksSafe.rejected } : {}), ...(repoSafe.rejected ? { repoRejected: repoSafe.rejected } : {}), telemetry,
    },
    constellations, constellationEdges: edges, weather, notionGraph, timeline, money,
  };
  const fleetPlan = collect("fleetPlan", () => collectors.fleetPlan(bots, env), { fleetStars: [], landings: [], queue: [], queueHead: null, mergeGateNote: "Development queue unavailable." });
  const skyFeed = collect("skyFeed", () => collectors.skyFeed({ conductor, gapDispatcher, locks, lockTransitionText: transitionText, commits: branchCommits.length ? branchCommits : commits, fleetPlan, notionGraph, nowMs: now }), {
    events: [], list: [], sources: { conductor: "unavailable", gap: "unavailable", lock: "unavailable", landing: "unavailable", commit: "unavailable", merge_gate: "unavailable", notion_stop: "private" }, droppedFlood: 0, droppedStale: 0, droppedDupes: 0, generatedAtMs: now,
  });
  const charts = collect("charts", () => collectors.charts({ commits: branchCommits.length ? branchCommits : commits, timeline, landings: fleetPlan.landings, money, bots, nowMs: now }), emptyCharts(now, "Activity unavailable: chart generation failed."));
  const notionMirror = collect("notionMirror", () => collectors.mirror({ bots, graph: notionGraph, nowMs: now }), { available: false, reason: "Notion mirror generation failed.", mode: "unavailable" as const, generatedAt: null, rows: [], staleCount: 0, mappedCount: 0 });
  if (telemetry.notionMirror.outcome === "available" && !notionGraph.available) record("notionMirror", "private", "private", null, null, "private_source");
  const projects = collect("projects", () => collectors.projects(base), { available: false, reason: "Development projects unavailable.", projects: [], agents: [], generatedAt });
  return { ...base, projects, fleetPlan, skyFeed, charts, notionMirror };
}
