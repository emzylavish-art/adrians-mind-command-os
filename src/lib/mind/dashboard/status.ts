import { DASHBOARD_BOTS, matchBotForLock } from "./bots.ts";
import { loadConductorNudges, loadGapDispatcherFeed, loadSpend, orchestratorFromLocks } from "./feeds.ts";
import { collectRecentCommits, latestCommitActivityForBranch, repoDirFromEnv } from "./git.ts";
import { classifyHealth } from "./health.ts";
import { locksDirFromEnv, readLocksDir } from "./locks.ts";
import { fetchNotionStopPoints } from "./notion.ts";
import { buildConstellations, constellationEdges, systemWeather } from "./constellations.ts";
import { loadNotionSnapshotFile } from "./notion-graph.ts";
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
  const locksDir = locksDirFromEnv(env);
  const repoDir = repoDirFromEnv(env);
  const locks = readLocksDir(locksDir);
  let commits: DashboardStatus["commits"] = [];
  let gitOk = true;
  try {
    commits = collectRecentCommits(repoDir, 20);
  } catch {
    gitOk = false;
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
  // Prefer live Notion when token works — snapshot remains the graph source until live crawl lands
  if (notion.available) {
    notionGraph.mode = notionGraph.available ? notionGraph.mode : "live";
  }

  return {
    generatedAt: new Date(now).toISOString(),
    bots,
    commits,
    notion,
    conductor: loadConductorNudges("/workspace"),
    gapDispatcher: loadGapDispatcherFeed("/workspace/rea-captures"),
    orchestrator: orchestratorFromLocks(locks),
    spend: loadSpend(),
    sources: {
      locksDir,
      repoDir,
      locksOk: locks.length > 0,
      gitOk,
    },
    constellations: buildConstellations(bots),
    constellationEdges: constellationEdges(bots),
    weather: systemWeather(bots),
    notionGraph,
  };
}
