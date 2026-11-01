/**
 * Pure builders for rich star/building detail cards.
 * Real sources only — missing fields become "no source yet".
 */
import type { Constellation, ConstellationEdge } from "./constellations.ts";
import type { FleetPlan } from "./fleet-plan.ts";
import type { QueueItem } from "./queue-parse.ts";
import type { NotionGraph, NotionSnapPage } from "./notion-graph-core.ts";
import type { BotNode, DashboardBotId, GitCommit, Health } from "./types.ts";

export const NO_SOURCE = "no source yet";

export type BotConnection = {
  id: string;
  name: string;
  kind: "lane" | "hub" | "notion" | "unknown";
};

export type BotDetailView = {
  botId: DashboardBotId;
  name: string;
  health: Health;
  reason: string;
  laneName: string | null;
  laneHealth: Health | null;
  lockFile: string | null;
  lockStatus: string | null;
  claimedAt: string | null;
  releasedAt: string | null;
  heartbeatAt: string | null;
  task: string | null;
  branch: string | null;
  worktree: string | null;
  /** Commits listed on the lock file (often short notes). */
  lockCommits: string[];
  /** Recent git commits on the bot's branch from the real git log (may be empty). */
  branchCommits: GitCommit[];
  /** Queue rows whose title/detail mention this bot or its lane (honest empty). */
  queueItems: QueueItem[];
  /** Notion pages mapped or neighboring the mapped page. */
  notionPages: NotionSnapPage[];
  /** Constellation neighbors + notion bot mentions. */
  connections: BotConnection[];
  notes: string;
};

function stripQuotes(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim().replace(/^["']|["']$/g, "").trim();
  return t || null;
}

export function lockHeartbeat(lock: BotNode["lock"]): string | null {
  if (!lock) return null;
  return stripQuotes(lock.raw.heartbeat_at ?? lock.raw.heartbeat ?? null);
}

export function lockTask(lock: BotNode["lock"]): string | null {
  if (!lock) return null;
  return stripQuotes(lock.raw.task ?? lock.raw.working_on ?? lock.raw.workingOn ?? null);
}

/** Filter global git commits that belong to this bot's branch (exact or origin/ prefix). */
export function commitsForBranch(commits: readonly GitCommit[], branch: string | null, limit = 8): GitCommit[] {
  if (!branch || !commits.length) return [];
  const want = branch.replace(/^origin\//, "");
  const out: GitCommit[] = [];
  for (const c of commits) {
    const b = (c.branch ?? "").replace(/^origin\//, "");
    if (b === want || b.endsWith(`/${want}`) || b.includes(want)) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function queueItemsForBot(queue: readonly QueueItem[], bot: BotNode, laneName: string | null): QueueItem[] {
  const needles = [bot.id, bot.name, laneName ?? "", bot.branch ?? ""]
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 2);
  if (!needles.length || !queue.length) return [];
  return queue.filter((q) => {
    const hay = `${q.title} ${q.detail}`.toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
}

export function notionPagesForBot(graph: NotionGraph, botId: DashboardBotId, limit = 6): NotionSnapPage[] {
  if (!graph.available || !graph.pages.length) return [];
  const mapped = graph.botPageMap[botId];
  const byId = new Map(graph.pages.map((p) => [p.id, p] as const));
  const out: NotionSnapPage[] = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    const p = byId.get(id);
    if (!p) return;
    seen.add(id);
    out.push(p);
  };
  push(mapped);
  if (mapped) {
    for (const e of graph.edges) {
      if (e.from === mapped) push(e.to);
      if (e.to === mapped) push(e.from);
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}

export function connectionsForBot(
  bot: BotNode,
  edges: readonly ConstellationEdge[],
  bots: readonly BotNode[],
  graph: NotionGraph,
): BotConnection[] {
  const byId = new Map(bots.map((b) => [b.id, b] as const));
  const out: BotConnection[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    let other: string | null = null;
    if (e.from === bot.id) other = e.to;
    else if (e.to === bot.id) other = e.from;
    if (!other || seen.has(other)) continue;
    seen.add(other);
    const n = byId.get(other as DashboardBotId);
    out.push({ id: other, name: n?.name ?? other, kind: e.kind });
  }
  const mapped = graph.botPageMap[bot.id];
  if (mapped) {
    const page = graph.pages.find((p) => p.id === mapped);
    if (page && !seen.has(page.id)) {
      out.push({ id: page.id, name: page.title || page.id, kind: "notion" });
    }
  }
  return out;
}

export function buildBotDetailView(input: {
  bot: BotNode;
  bots: readonly BotNode[];
  commits: readonly GitCommit[];
  constellations: readonly Constellation[];
  constellationEdges: readonly ConstellationEdge[];
  notionGraph: NotionGraph;
  fleetPlan: FleetPlan | null | undefined;
}): BotDetailView {
  const { bot } = input;
  const lane = input.constellations.find((c) => c.botIds.includes(bot.id)) ?? null;
  const laneName = lane?.name ?? null;
  return {
    botId: bot.id,
    name: bot.name,
    health: bot.health,
    reason: bot.reason || NO_SOURCE,
    laneName,
    laneHealth: lane?.health ?? null,
    lockFile: bot.lock?.file ?? null,
    lockStatus: bot.lock?.status ?? null,
    claimedAt: bot.lock?.claimed_at ?? null,
    releasedAt: bot.lock?.released_at ?? null,
    heartbeatAt: lockHeartbeat(bot.lock),
    task: lockTask(bot.lock),
    branch: bot.branch,
    worktree: bot.lock?.worktree ?? null,
    lockCommits: bot.commits ?? [],
    branchCommits: commitsForBranch(input.commits, bot.branch),
    queueItems: queueItemsForBot(input.fleetPlan?.queue ?? [], bot, laneName),
    notionPages: notionPagesForBot(input.notionGraph, bot.id),
    connections: connectionsForBot(bot, input.constellationEdges, input.bots, input.notionGraph),
    notes: bot.notes || "",
  };
}

/** Neighbors of a Notion page id (parent/child/link) for Obsidian-style highlight. */
export function notionNeighborIds(graph: NotionGraph, pageId: string, limit = 24): string[] {
  if (!pageId || !graph.edges.length) return [];
  const out: string[] = [];
  const seen = new Set<string>([pageId]);
  for (const e of graph.edges) {
    let other: string | null = null;
    if (e.from === pageId) other = e.to;
    else if (e.to === pageId) other = e.from;
    if (!other || seen.has(other) || other.startsWith("bot:")) continue;
    seen.add(other);
    out.push(other);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatWat(iso: string | null | undefined): string {
  if (!iso) return NO_SOURCE;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return NO_SOURCE;
  return `${new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false })} WAT`;
}
