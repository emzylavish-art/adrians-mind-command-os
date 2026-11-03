/**
 * Gap #59 — slim poll payload + preserve fields the live HUD needs.
 * Heavy excerpts / timeline samples / full notion pages load lazily per bot.
 */
import type { DashboardStatus } from "./types.ts";

export const STATUS_SUMMARY_MARK = "summary" as const;

const MAX_TIMELINE_EVENTS = 48;
const MAX_SKY_FEED = 24;
const MAX_COMMITS = 24;
const MAX_QUEUE = 16;
const MAX_NOTE = 160;
const MAX_PAGE_TITLE = 96;

export type StatusSummaryMeta = {
  mode: typeof STATUS_SUMMARY_MARK;
  /** Full bot detail: GET /api/mind/dashboard/bot?id= */
  botDetailPath: string;
  truncated: {
    timelineEvents?: number;
    skyFeed?: number;
    commits?: number;
    notionPages?: number;
    queue?: number;
  };
};

function trimNote(s: string | null | undefined, max = MAX_NOTE): string {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trimEnd();
}

/** Slim a publicized DashboardStatus for the 20s poll (gzip-friendly, no invented fields). */
export function slimDashboardStatusForPoll<T extends Record<string, unknown>>(status: T): T & { summary: StatusSummaryMeta } {
  const src = status as unknown as DashboardStatus;
  const truncated: StatusSummaryMeta["truncated"] = {};

  const bots = (src.bots ?? []).map((b) => ({
    ...b,
    notes: trimNote(b.notes),
    commits: (b.commits ?? []).slice(0, 4),
    lock: b.lock
      ? {
          ...b.lock,
          notes: trimNote(b.lock.notes),
          commits: (b.lock.commits ?? []).slice(0, 4),
        }
      : null,
  }));

  let timeline = src.timeline;
  if (timeline?.events && timeline.events.length > MAX_TIMELINE_EVENTS) {
    truncated.timelineEvents = timeline.events.length - MAX_TIMELINE_EVENTS;
    timeline = {
      ...timeline,
      events: timeline.events.slice(-MAX_TIMELINE_EVENTS),
      truncated: true,
    };
  }

  let skyFeed: unknown = src.skyFeed;
  if (Array.isArray(skyFeed) && skyFeed.length > MAX_SKY_FEED) {
    truncated.skyFeed = skyFeed.length - MAX_SKY_FEED;
    skyFeed = skyFeed.slice(0, MAX_SKY_FEED);
  } else if (skyFeed && typeof skyFeed === "object") {
    const bag = skyFeed as { events?: unknown[]; list?: unknown[] };
    const ev = Array.isArray(bag.events) ? bag.events : null;
    const list = Array.isArray(bag.list) ? bag.list : null;
    let next = { ...bag };
    if (ev && ev.length > MAX_SKY_FEED) {
      truncated.skyFeed = (truncated.skyFeed ?? 0) + (ev.length - MAX_SKY_FEED);
      next = { ...next, events: ev.slice(0, MAX_SKY_FEED) };
    }
    if (list && list.length > MAX_SKY_FEED) {
      truncated.skyFeed = (truncated.skyFeed ?? 0) + (list.length - MAX_SKY_FEED);
      next = { ...next, list: list.slice(0, MAX_SKY_FEED) };
    }
    skyFeed = next;
  }

  let commits = src.commits ?? [];
  if (commits.length > MAX_COMMITS) {
    truncated.commits = commits.length - MAX_COMMITS;
    commits = commits.slice(0, MAX_COMMITS);
  }

  let notionGraph = src.notionGraph;
  if (notionGraph?.pages?.length) {
    truncated.notionPages = notionGraph.pages.length;
    notionGraph = {
      ...notionGraph,
      pages: notionGraph.pages.map((p) => ({
        ...p,
        title: trimNote(p.title, MAX_PAGE_TITLE),
        excerpt: "", // lazy via bot detail / notion open
      })),
      // keep edges — needed for neighbor highlight; if huge, cap
      edges: (notionGraph.edges ?? []).slice(0, 400),
    };
  }

  let fleetPlan = src.fleetPlan;
  if (fleetPlan?.queue && fleetPlan.queue.length > MAX_QUEUE) {
    truncated.queue = fleetPlan.queue.length - MAX_QUEUE;
    fleetPlan = {
      ...fleetPlan,
      queue: fleetPlan.queue.slice(0, MAX_QUEUE).map((q) => ({
        ...q,
        detail: trimNote(q.detail, 120),
      })),
    };
  }

  let notionMirror = (src as { notionMirror?: { rows?: Array<Record<string, unknown>> } }).notionMirror;
  if (notionMirror?.rows) {
    notionMirror = {
      ...notionMirror,
      rows: notionMirror.rows.map((r) => ({
        ...r,
        excerpt: null,
        title: trimNote(String(r.title ?? ""), MAX_PAGE_TITLE),
      })),
    };
  }

  const summary: StatusSummaryMeta = {
    mode: STATUS_SUMMARY_MARK,
    botDetailPath: "/api/mind/dashboard/bot",
    truncated,
  };

  return {
    ...status,
    bots,
    timeline,
    skyFeed,
    commits,
    notionGraph,
    fleetPlan,
    ...(notionMirror ? { notionMirror } : {}),
    summary,
  } as T & { summary: StatusSummaryMeta };
}

/** Build a per-bot detail bag from a full (or summary) status — never invents bots. */
export function botDetailFromStatus(status: DashboardStatus, botId: string) {
  const bot = status.bots.find((b) => b.id === botId) ?? null;
  if (!bot) {
    return { ok: false as const, error: "bot_not_found", botId };
  }
  const pageId = status.notionGraph?.botPageMap?.[bot.id as keyof typeof status.notionGraph.botPageMap];
  const pages = (status.notionGraph?.pages ?? []).filter(
    (p) => p.id === pageId || (bot.name && p.title?.includes(bot.name.slice(0, 12))),
  );
  // Prefer mapped page; if excerpts were stripped in summary, client may still need lock notes (already on bot).
  return {
    ok: true as const,
    bot,
    notionPages: pages.slice(0, 8),
    branchCommits: (status.commits ?? []).filter((c) => c.branch && bot.branch && c.branch.includes(bot.branch.replace(/^origin\//, "").slice(0, 12))).slice(0, 8),
  };
}
