/**
 * Pure builders for rich star/building detail cards.
 * Real sources only — missing fields become "no source yet".
 */
import type { Constellation, ConstellationEdge } from "./constellations.ts";
import type { FleetPlan } from "./fleet-plan.ts";
import type { QueueItem } from "./queue-parse.ts";
import type { NotionGraph, NotionSnapPage } from "./notion-graph-core.ts";
import type { BotNode, DashboardBotId, GitCommit, Health } from "./types.ts";
import type { Timeline, TimelineEvent } from "./time-scrub.ts";

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
  /** Gap#56: display line for lane rollup (never confused with bot health). */
  laneHealthLine: string | null;
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
  /** Timeline lock claim/release/heartbeat for this bot. */
  lockHistory: LockHistoryRow[];
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
  // Gap#35: prefer promoted field; raw may be omitted after publicize
  const fromTop = lock.heartbeatAt ?? null;
  const raw = lock.raw;
  const fromRaw =
    raw && typeof raw === "object"
      ? (raw.heartbeat_at ?? raw.heartbeat ?? raw.heartbeatAt ?? null)
      : null;
  return stripQuotes(fromTop ?? fromRaw);
}

export function lockTask(lock: BotNode["lock"]): string | null {
  if (!lock) return null;
  const fromTop = lock.task ?? null;
  const raw = lock.raw;
  const fromRaw =
    raw && typeof raw === "object"
      ? (raw.task ?? raw.working_on ?? raw.workingOn ?? null)
      : null;
  return stripQuotes(fromTop ?? fromRaw);
}

/** Map a git branch name onto a dashboard bot id (shared with charts). */
export function botIdFromBranch(branch: string): string {
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
  return b.slice(0, 24) || "unknown";
}

/** Filter global git commits that belong to this bot's branch (exact, origin/, or branch→bot map). */
export function commitsForBranch(
  commits: readonly GitCommit[],
  branch: string | null,
  limit = 8,
  botId?: string | null,
): GitCommit[] {
  if (!commits.length) return [];
  const want = branch ? branch.replace(/^origin\//, "") : "";
  const out: GitCommit[] = [];
  const seen = new Set<string>();
  const push = (c: GitCommit) => {
    if (seen.has(c.sha)) return;
    seen.add(c.sha);
    out.push(c);
  };
  for (const c of commits) {
    const b = (c.branch ?? "").replace(/^origin\//, "");
    const mapped = botIdFromBranch(b);
    const branchHit = want && (b === want || b.endsWith(`/${want}`) || b.includes(want));
    const botHit = botId && mapped === botId;
    if (branchHit || botHit) {
      push(c);
      if (out.length >= limit) break;
    }
  }
  // Hub bots (e.g. grok-build) with empty branch match: still show recent integration commits.
  if (!out.length && botId === "grok-build") {
    for (const c of commits) {
      if (botIdFromBranch(c.branch ?? "") === "grok-build") {
        push(c);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}


export type LockHistoryRow = {
  atMs: number;
  atIso: string;
  kind: TimelineEvent["kind"];
  label: string;
  lockFile?: string;
};

/** Real lock claim/release/heartbeat rows for a bot from the timeline (honest empty). */
export function lockHistoryFromTimeline(
  timeline: Timeline | null | undefined,
  botId: DashboardBotId,
  limit = 12,
): LockHistoryRow[] {
  const events = timeline?.events ?? [];
  if (!events.length) return [];
  const out: LockHistoryRow[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.botId !== botId) continue;
    if (e.kind !== "lock_claim" && e.kind !== "lock_release" && e.kind !== "lock_heartbeat") continue;
    out.push({
      atMs: e.atMs,
      atIso: e.atIso,
      kind: e.kind,
      label: e.label,
      lockFile: e.lockFile,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Match queue + optional gap-feed titles that mention this bot (real text only). */
export function queueItemsForBot(queue: readonly QueueItem[], bot: BotNode, laneName: string | null): QueueItem[] {
  const nameRoot = bot.name.replace(/\s+bot$/i, "").trim();
  const needles = [bot.id, bot.name, nameRoot, laneName ?? "", bot.branch ?? "", bot.lock?.file ?? ""]
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


/** Gap#56: bots in the same lane whose health matches the rolled-up lane health (not this bot). */
export function laneHealthDrivers(
  bots: readonly BotNode[],
  laneBotIds: readonly string[] | null | undefined,
  laneHealth: Health | null | undefined,
  selfId: string,
): BotNode[] {
  if (!laneBotIds?.length || !laneHealth) return [];
  const want = new Set(laneBotIds);
  return bots.filter((b) => b.id !== selfId && want.has(b.id) && b.health === laneHealth);
}

/** Gap#56: honest label so bot health and lane rollup are not confused. */
export function formatLaneHealthLine(
  laneName: string | null | undefined,
  laneHealth: Health | null | undefined,
  drivers: readonly { id: string; name?: string | null }[],
): string | null {
  if (!laneName) return null;
  const healthBit = laneHealth ? ` · ${laneHealth}` : "";
  if (!drivers.length) return `${laneName}${healthBit}`;
  const names = drivers
    .slice(0, 3)
    .map((d) => (d.name && d.name.trim() ? d.name.trim() : d.id))
    .join(", ");
  const more = drivers.length > 3 ? ` +${drivers.length - 3}` : "";
  return `${laneName}${healthBit} (from ${names}${more})`;
}

export function buildBotDetailView(input: {
  bot: BotNode;
  bots: readonly BotNode[];
  commits: readonly GitCommit[];
  constellations: readonly Constellation[];
  constellationEdges: readonly ConstellationEdge[];
  notionGraph: NotionGraph;
  fleetPlan: FleetPlan | null | undefined;
  timeline?: Timeline | null;
  gapFeedTitles?: readonly string[] | null;
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
    laneHealthLine: formatLaneHealthLine(
      laneName,
      lane?.health ?? null,
      laneHealthDrivers(input.bots, lane?.botIds, lane?.health ?? null, bot.id),
    ),
    lockFile: bot.lock?.file ?? null,
    lockStatus: bot.lock?.status ?? null,
    claimedAt: bot.lock?.claimed_at ?? null,
    releasedAt: bot.lock?.released_at ?? null,
    heartbeatAt: lockHeartbeat(bot.lock) ?? bot.lastActivityAt,
    task: lockTask(bot.lock),
    branch: bot.branch,
    worktree: bot.lock?.worktree ?? null, // already public-label when API-publicized
    lockCommits: bot.commits ?? [],
    lockHistory: lockHistoryFromTimeline(input.timeline, bot.id, 12),
    branchCommits: commitsForBranch(input.commits, bot.branch, 8, bot.id),
    queueItems: (() => {
      const fromQueue = queueItemsForBot(input.fleetPlan?.queue ?? [], bot, laneName);
      if (fromQueue.length || !(input.gapFeedTitles?.length)) return fromQueue;
      // Promote gap-feed titles that mention this bot into honest queue-like rows (index -1).
      const extra = input.gapFeedTitles
        .filter((title) => {
          const hay = title.toLowerCase();
          const nameRoot = bot.name.replace(/\s+bot$/i, "").trim().toLowerCase();
          return hay.includes(bot.id) || (nameRoot.length > 2 && hay.includes(nameRoot));
        })
        .slice(0, 4)
        .map((title, i) => ({
          index: -(i + 1),
          title,
          status: "feed",
          detail: "from gap-feed.md",
        }));
      return extra as import("./queue-parse.ts").QueueItem[];
    })(),
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
