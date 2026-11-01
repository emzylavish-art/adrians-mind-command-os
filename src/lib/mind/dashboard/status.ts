import { DASHBOARD_BOTS, matchBotForLock } from "./bots.ts";
import { loadConductorNudges, loadGapDispatcherFeed, loadSpend, orchestratorFromLocks } from "./feeds.ts";
import { loadMoneyView } from "./spend.ts";
import { buildDashboardCharts } from "./chart-series.ts";
import { buildNotionMirrorView } from "./notion-mirror.ts";
import { buildForeverContractGuard } from "./forever-contract.ts";
import { collectBranchCommits, collectKnownBotBranchCommits, collectRecentCommitsResult, latestCommitActivityForBranch } from "./git.ts";
import { branchesForBot } from "./bot-branches.ts";
import { loadLaneQueueDocs } from "./lane-queue.ts";
import { composeBotNotes } from "./bot-detail.ts";
import { loadCommitsSnapshot } from "./commits-snapshot.ts";
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

export const MAX_STATUS_BOTS = 96; // Gap#33: keep status JSON + edge build bounded

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
  let commitsSource: "git" | "snapshot" | "none" = "none";
  let commitsSnapshotAt: string | undefined;
  try {
    const res = collectRecentCommitsResult(repoDir, 40);
    gitOk = res.ok;
    commits = res.commits;
    if (!res.ok) gitError = res.error;
    if (res.ok && res.commits.length) commitsSource = "git";
  } catch (error) {
    gitOk = false;
    gitError = error instanceof Error ? error.message : String(error);
    commits = [];
  }
  // Vercel / hosts without .git: fall back to build-time snapshot (never invent).
  if (!commits.length) {
    const snap = loadCommitsSnapshot();
    if (snap?.commits?.length) {
      commits = snap.commits.slice(0, 40);
      commitsSource = "snapshot";
      commitsSnapshotAt = snap.generatedAt || undefined;
      gitOk = true;
      gitError = gitError
        ? `${gitError}; using commits snapshot @ ${snap.generatedAt || "unknown"}`
        : `git unavailable; using commits snapshot @ ${snap.generatedAt || "unknown"}`;
    }
  }

  // Per-bot origin branches (bounded + cached). Merge so Star Detail Recent commits can resolve.
  try {
    const perBot = collectKnownBotBranchCommits(repoDir, now);
    if (perBot.length) {
      const seen = new Set(commits.map((c) => c.sha));
      for (const c of perBot) {
        if (seen.has(c.sha)) continue;
        seen.add(c.sha);
        commits.push(c);
      }
      if (commitsSource === "none") commitsSource = "git";
      gitOk = true;
    }
  } catch {
    /* keep prior commits */
  }

  const bots: BotNode[] = DASHBOARD_BOTS.map((def) => {
    const lock = pickPrimaryLock(locks, def.lockMatchers, def.ownerMatchers);
    const known = branchesForBot(def.id, lock?.branch ?? null);
    const branch = known[0] ?? lock?.branch ?? null;
    const gitActivity = latestCommitActivityForBranch(commits, branch);
    const lastActivityAt = gitActivity || lock?.released_at || lock?.claimed_at || null;
    const { health, reason } = classifyHealth({ lock, lastActivityAt, now });
    const notes = composeBotNotes({
      lockNotes: lock?.notes,
      botNotes: "",
      notionTitles: [], // filled after notion graph loads
      maxLen: 1200,
    });
    return {
      id: def.id,
      name: def.name,
      health,
      lock,
      branch,
      lastActivityAt,
      commits: lock?.commits ?? [],
      notes,
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
  let statusBots = bots;
  let botsTruncated = false;
  if (statusBots.length > MAX_STATUS_BOTS) {
    statusBots = statusBots.slice(0, MAX_STATUS_BOTS);
    botsTruncated = true;
  }
  const constellations = buildConstellations(statusBots);
  const edges = constellationEdges(statusBots);
  const weather = systemWeather(statusBots);

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
    bots: statusBots,
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
      ...(botsTruncated ? { botsTruncated: true, botsCap: MAX_STATUS_BOTS } : {}),
      gitOk,
      commitsSource,
      ...(commitsSnapshotAt ? { commitsSnapshotAt } : {}),
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

  // Enrich notes with mapped Notion page titles (real titles only).
  for (const bot of statusBots) {
    const mapped = notionGraph.botPageMap?.[bot.id];
    const titles: string[] = [];
    if (mapped) {
      const page = notionGraph.pages.find((p) => p.id === mapped);
      if (page?.title) titles.push(page.title);
    }
    for (const p of notionGraph.pages) {
      if (titles.length >= 4) break;
      const hay = `${p.title}`.toLowerCase();
      if (hay.includes(bot.id) || hay.includes(bot.name.replace(/\s+bot$/i, "").trim().toLowerCase())) {
        if (p.title && !titles.includes(p.title)) titles.push(p.title);
      }
    }
    if (notion.available && "stopPoints" in notion) {
      for (const sp of notion.stopPoints.slice(0, 24)) {
        if (titles.length >= 6) break;
        const text = typeof sp.text === "string" ? sp.text : "";
        const hay = text.toLowerCase();
        if (hay.includes(bot.id) || hay.includes(bot.name.replace(/\s+bot$/i, "").trim().toLowerCase().slice(0, 12))) {
          const line = text.split("\n")[0]!.trim().slice(0, 160);
          if (line && !titles.includes(line)) titles.push(line);
        }
      }
    }
    bot.notes = composeBotNotes({
      lockNotes: bot.lock?.notes,
      botNotes: bot.notes,
      notionTitles: titles,
    });
  }

  const fleetPlan = buildFleetPlan(statusBots, env);
  try {
    const laneItems = loadLaneQueueDocs(repoDir);
    if (laneItems.length) {
      const seen = new Set(fleetPlan.queue.map((q) => `${q.index}:${q.title}`));
      for (const it of laneItems) {
        const key = `${it.index}:${it.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fleetPlan.queue.push(it);
      }
    }
  } catch {
    /* lane docs optional */
  }
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
      bots: statusBots,
      nowMs: now,
    });
  } catch {
    charts = buildDashboardCharts({ nowMs: now });
  }

  let notionMirror;
  try {
    notionMirror = buildNotionMirrorView({ bots: statusBots, graph: notionGraph, nowMs: now });
  } catch {
    notionMirror = buildNotionMirrorView({ bots: [], graph: null, nowMs: now });
  }

  let foreverContract;
  try {
    foreverContract = buildForeverContractGuard({
      queue: fleetPlan.queue,
      bots: statusBots,
      nowMs: now,
      queueSource: fleetPlan.queueSource,
    });
  } catch {
    foreverContract = buildForeverContractGuard({ queue: [], bots: [], nowMs: now, queueSource: "unavailable" });
  }

  return {
    ...base,
    projects: buildProjectsDashboard(base),
    fleetPlan,
    skyFeed,
    charts,
    notionMirror,
    foreverContract,
  };
}
