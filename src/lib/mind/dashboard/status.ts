import { DASHBOARD_BOTS, matchBotForLock } from "./bots.ts";
import { loadConductorNudges, loadGapDispatcherFeed, loadSpend, orchestratorFromLocks } from "./feeds.ts";
import { loadMoneyView } from "./spend.ts";
import { buildDashboardCharts } from "./chart-series.ts";
import { buildNotionMirrorView } from "./notion-mirror.ts";
import { collectBranchCommits, collectRecentCommitsResult, latestCommitActivityForBranch } from "./git.ts";
import { buildTimeline, parseLockTransitionLog } from "./time-scrub.ts";
import { buildSkyFeed } from "./sky-feed.ts";
import { readFileSync } from "node:fs";
import { locksDirFromEnvSafe, repoDirFromEnvSafe } from "./safe-paths.ts";
import { classifyHealth } from "./health.ts";
import { readLocksDir } from "./locks.ts";
import { fetchNotionStopPoints } from "./notion.ts";
import { buildConstellations, constellationEdges, systemWeather } from "./constellations.ts";
import { loadNotionSnapshotFile } from "./notion-graph.ts";
import { buildProjectsDashboard } from "./projects.ts";
import { buildFleetPlan } from "./fleet-plan.ts";
import type { BotNode, DashboardStatus, LockRecord } from "./types.ts";

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

export async function buildDashboardStatus(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<DashboardStatus> {
  const locksSafe = locksDirFromEnvSafe(env);
  const repoSafe = repoDirFromEnvSafe(env);
  const locksDir = locksSafe.path;
  const repoDir = repoSafe.path;
  const locks = readLocksDir(locksDir);
  let commits: DashboardStatus["commits"] = [];
  let gitOk = false;
  let gitError: string | undefined;
  try {
    const res = collectRecentCommitsResult(repoDir, 20);
    gitOk = res.ok;
    commits = res.commits;
    if (!res.ok) gitError = res.error;
  } catch (error) {
    gitOk = false;
    gitError = error instanceof Error ? error.message : String(error);
    commits = [];
  }

  const bots: BotNode[] = DASHBOARD_BOTS.map((def) => {
    const lock = pickPrimaryLock(locks, def.lockMatchers, def.ownerMatchers);
    const branch = lock?.branch ?? null;
    const gitActivity = latestCommitActivityForBranch(commits, branch);
    const lastActivityAt = gitActivity || lock?.released_at || lock?.claimed_at || null;
    const { health, reason } = classifyHealth({ lock, lastActivityAt, now });
    return {
      id: def.id,
      name: def.name,
      health,
      lock,
      branch,
      lastActivityAt,
      commits: lock?.commits ?? [],
      notes: lock?.notes ?? "",
      reason,
    };
  });

  // Attach unmatched locks as notes on closest bot when possible (no fake bots)
  for (const lock of locks) {
    const matched = matchBotForLock(lock.file, lock.owner);
    if (!matched) {
      // leave unmatched — still visible via orchestrator/feeds if relevant
      continue;
    }
  }

  const notion = await fetchNotionStopPoints(env.NOTION_TOKEN);
  const notionGraph = loadNotionSnapshotFile();
  if (notion.available) {
    notionGraph.mode = notionGraph.available ? notionGraph.mode : "live";
  }

  const conductor = loadConductorNudges("/workspace");
  const gapDispatcher = loadGapDispatcherFeed("/workspace/rea-captures");
  const orchestrator = orchestratorFromLocks(locks);
  const spend = loadSpend();
  const money = loadMoneyView({ nowMs: now });
  // charts built after fleetPlan below
  const constellations = buildConstellations(bots);
  const edges = constellationEdges(bots);
  const weather = systemWeather(bots);

  // Queue #5 TIME: fleet+dashboard commits + lock timestamps + transition log
  let transitionText = "";
  try {
    transitionText = readFileSync("/workspace/audit/dashboard-3d/lock-transitions.log", "utf8");
  } catch {
    transitionText = "";
  }
  let fleetCommits = commits;
  try {
    fleetCommits = collectBranchCommits(repoDir, undefined, 80);
  } catch {
    fleetCommits = commits;
  }
  const timeline = buildTimeline({
    commits: fleetCommits.length ? fleetCommits : commits,
    locks,
    transitions: parseLockTransitionLog(transitionText),
    nowMs: now,
  });

  const base = {
    generatedAt: new Date(now).toISOString(),
    bots,
    commits,
    notion,
    conductor,
    gapDispatcher,
    orchestrator,
    spend,
    sources: {
      locksDir,
      repoDir,
      locksOk: locks.length > 0,
      gitOk,
      ...(gitError ? { gitError } : {}),
      ...(locksSafe.rejected ? { locksRejected: locksSafe.rejected } : {}),
      ...(repoSafe.rejected ? { repoRejected: repoSafe.rejected } : {}),
    },
    constellations,
    constellationEdges: edges,
    weather,
    notionGraph,
    timeline,
    money,
  };

  const fleetPlan = buildFleetPlan(bots, env);
  const skyFeed = buildSkyFeed({
    conductor,
    gapDispatcher,
    locks,
    lockTransitionText: transitionText,
    commits: fleetCommits.length ? fleetCommits : commits,
    fleetPlan,
    notionGraph,
    nowMs: now,
  });
  let charts;
  try {
    charts = buildDashboardCharts({
      commits: fleetCommits.length ? fleetCommits : commits,
      timeline: base.timeline,
      landings: fleetPlan.landings,
      money,
      nowMs: now,
    });
  } catch {
    charts = buildDashboardCharts({ nowMs: now });
  }

  let notionMirror;
  try {
    notionMirror = buildNotionMirrorView({ bots, graph: notionGraph, nowMs: now });
  } catch {
    notionMirror = buildNotionMirrorView({ bots: [], graph: null, nowMs: now });
  }

  return {
    ...base,
    projects: buildProjectsDashboard(base),
    fleetPlan,
    skyFeed,
    charts,
    notionMirror,
  };
}
