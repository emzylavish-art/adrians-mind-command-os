/**
 * Queue #6 — FEED builder (Dashboard Bot).
 *
 * Aggregates real sky-feed events: Conductor nudges, Gap Dispatcher items,
 * lock transitions, landings/commits, Merge Gate notes, Notion stop-point
 * snapshot pages. Missing sources report "no source yet".
 *
 * Hacker: rate-limit + dedupe floods, sanitize long/HTML text, drop stale.
 */
import { sanitizeLabelText, parseTimeMs } from "./health.ts";
import { parseLockTransitionLog } from "./time-scrub.ts";
import type { DashboardBotId, GitCommit, LockRecord } from "./types.ts";
import type { FleetPlan } from "./fleet-plan.ts";
import type { FleetLandingStatus } from "./landing-status.ts";
import type { NotionGraph } from "./notion-graph.ts";

export const MAX_FEED_GLYPHS = 18;
export const MAX_FEED_LIST = 24;
export const MAX_PER_KIND = 8;
export const STALE_MS = 48 * 60 * 60 * 1000; // 48h
export const MAX_TEXT = 140;
export const NO_SOURCE = "no source yet";

export type FeedKind =
  | "conductor"
  | "gap"
  | "lock"
  | "landing"
  | "commit"
  | "merge_gate"
  | "notion_stop";

export type FeedEvent = {
  id: string;
  kind: FeedKind;
  text: string;
  atMs: number | null;
  botId: DashboardBotId | null;
  source: string;
  glyph: string;
};

export type SkyFeed = {
  events: FeedEvent[]; // glyphs (capped)
  list: FeedEvent[]; // glass list
  sources: Record<FeedKind, string>;
  droppedFlood: number;
  droppedStale: number;
  droppedDupes: number;
  generatedAtMs: number;
};

const GLYPH: Record<FeedKind, string> = {
  conductor: "◎",
  gap: "◆",
  lock: "▣",
  landing: "☄",
  commit: "✦",
  merge_gate: "⬡",
  notion_stop: "✉",
};

const BOT_IDS = new Set<string>([
  "grok-build",
  "conductor",
  "gap-dispatcher",
  "rea-feature-hunter",
  "merge-gate",
  "visual-polish",
  "logic",
  "mcp-integration",
  "media-integration",
  "voice-integration",
  "voice-wiring",
  "error-banners",
  "xai-verification",
  "hp-pairing",
  "dashboard",
  "cosmos-painter",
  "cosmos-light",
  "cosmos-motion",
]);

export function sanitizeFeedText(raw: string, max = MAX_TEXT): string {
  const noTags = String(raw ?? "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
  return sanitizeLabelText(noTags, max) || "…";
}

function stableId(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => String(p ?? ""))
    .join("|")
    .slice(0, 180);
}

function guessBotFromText(text: string): DashboardBotId | null {
  const t = text.toLowerCase();
  const pairs: Array<[RegExp, DashboardBotId]> = [
    [/cosmos\s*painter|visual-painter/, "cosmos-painter"],
    [/cosmos\s*light|visual-light/, "cosmos-light"],
    [/cosmos\s*motion|visual-motion/, "cosmos-motion"],
    [/dashboard\s*bot|dashboard-3d/, "dashboard"],
    [/merge\s*gate/, "merge-gate"],
    [/gap\s*dispatcher/, "gap-dispatcher"],
    [/conductor/, "conductor"],
    [/error\s*banners/, "error-banners"],
    [/voice\s*wiring/, "voice-wiring"],
    [/voice\s*integration/, "voice-integration"],
    [/media\s*integration/, "media-integration"],
    [/mcp\s*integration/, "mcp-integration"],
    [/visual\s*polish/, "visual-polish"],
    [/feature\s*hunter|rea\s*feature/, "rea-feature-hunter"],
    [/xai/, "xai-verification"],
    [/hp\s*pairing|pc-pairing/, "hp-pairing"],
    [/logic/, "logic"],
    [/grok\s*build|orchestrator/, "grok-build"],
  ];
  for (const [re, id] of pairs) {
    if (re.test(t)) return id;
  }
  return null;
}

function asBot(id: string | null | undefined): DashboardBotId | null {
  if (!id) return null;
  return BOT_IDS.has(id) ? (id as DashboardBotId) : null;
}

export type BuildSkyFeedInput = {
  conductor?: { source: string; nudges: string[] };
  gapDispatcher?: { source: string; items: Array<{ rank?: number; feature: string; status?: string }> };
  locks?: readonly LockRecord[];
  lockTransitionText?: string;
  commits?: readonly GitCommit[];
  fleetPlan?: FleetPlan | null;
  notionGraph?: NotionGraph | null;
  nowMs?: number;
  staleMs?: number;
  maxGlyphs?: number;
  maxList?: number;
  maxPerKind?: number;
};

function sourceOrNone(src: string | null | undefined, hasItems: boolean): string {
  if (!src || src === "unavailable" || src === "none") return NO_SOURCE;
  if (!hasItems && (src === "unavailable" || !src)) return NO_SOURCE;
  return src;
}

/**
 * Build the sky feed from real inputs only. Never invents rows for missing sources.
 */
export function buildSkyFeed(input: BuildSkyFeedInput): SkyFeed {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const staleMs = Number.isFinite(input.staleMs) ? Math.max(0, input.staleMs as number) : STALE_MS;
  const maxGlyphs = Math.min(
    MAX_FEED_GLYPHS,
    Math.max(1, Math.floor(input.maxGlyphs ?? MAX_FEED_GLYPHS)),
  );
  const maxList = Math.min(MAX_FEED_LIST, Math.max(1, Math.floor(input.maxList ?? MAX_FEED_LIST)));
  const maxPerKind = Math.min(MAX_PER_KIND, Math.max(1, Math.floor(input.maxPerKind ?? MAX_PER_KIND)));

  const sources: Record<FeedKind, string> = {
    conductor: NO_SOURCE,
    gap: NO_SOURCE,
    lock: NO_SOURCE,
    landing: NO_SOURCE,
    commit: NO_SOURCE,
    merge_gate: NO_SOURCE,
    notion_stop: NO_SOURCE,
  };

  const raw: FeedEvent[] = [];
  let droppedStale = 0;

  const push = (ev: FeedEvent) => {
    if (ev.atMs != null && Number.isFinite(ev.atMs) && nowMs - ev.atMs > staleMs) {
      droppedStale += 1;
      return;
    }
    raw.push(ev);
  };

  // Conductor
  const cond = input.conductor;
  if (cond && cond.source && cond.source !== "unavailable" && cond.nudges.length) {
    sources.conductor = cond.source;
    for (const n of cond.nudges) {
      const text = sanitizeFeedText(n);
      push({
        id: stableId(["conductor", text]),
        kind: "conductor",
        text,
        atMs: null,
        botId: "conductor",
        source: cond.source,
        glyph: GLYPH.conductor,
      });
    }
  } else {
    sources.conductor = NO_SOURCE;
  }

  // Gap Dispatcher
  const gap = input.gapDispatcher;
  if (gap && gap.source && gap.source !== "unavailable" && gap.items.length) {
    sources.gap = gap.source;
    gap.items.forEach((g, i) => {
      const text = sanitizeFeedText(
        `${g.rank != null ? `#${g.rank} ` : ""}${g.feature}${g.status ? ` · ${g.status}` : ""}`,
      );
      push({
        id: stableId(["gap", g.rank ?? i, g.feature]),
        kind: "gap",
        text,
        atMs: null,
        botId: "gap-dispatcher",
        source: gap.source,
        glyph: GLYPH.gap,
      });
    });
  } else {
    sources.gap = NO_SOURCE;
  }

  // Lock transitions log
  const trText = input.lockTransitionText ?? "";
  const transitions = parseLockTransitionLog(trText);
  if (transitions.length) {
    sources.lock = "/workspace/audit/dashboard-3d/lock-transitions.log";
    for (const tr of transitions) {
      const text = sanitizeFeedText(`${tr.action} · ${tr.owner} · ${tr.note}`);
      const atMs = parseTimeMs(tr.atIso, nowMs);
      push({
        id: stableId(["lock", tr.atIso, tr.action, tr.owner, tr.note]),
        kind: "lock",
        text,
        atMs,
        botId: guessBotFromText(`${tr.owner} ${tr.note}`) ?? "dashboard",
        source: sources.lock,
        glyph: GLYPH.lock,
      });
    }
  } else if (input.locks && input.locks.length) {
    // Fall back to current lock claim/release notes (still real)
    sources.lock = "locks dir";
    for (const lock of input.locks) {
      if (lock.claimed_at) {
        const text = sanitizeFeedText(`claim ${lock.file} · ${lock.owner || "unknown"}`);
        push({
          id: stableId(["lock", "claim", lock.file, lock.claimed_at]),
          kind: "lock",
          text,
          atMs: parseTimeMs(lock.claimed_at, nowMs),
          botId: guessBotFromText(`${lock.file} ${lock.owner}`),
          source: lock.file,
          glyph: GLYPH.lock,
        });
      }
      if (lock.released_at) {
        const text = sanitizeFeedText(`release ${lock.file} · ${lock.owner || "unknown"}`);
        push({
          id: stableId(["lock", "release", lock.file, lock.released_at]),
          kind: "lock",
          text,
          atMs: parseTimeMs(lock.released_at, nowMs),
          botId: guessBotFromText(`${lock.file} ${lock.owner}`),
          source: lock.file,
          glyph: GLYPH.lock,
        });
      }
      const notes = (lock.notes || "").trim();
      if (notes) {
        push({
          id: stableId(["lock", "notes", lock.file, notes.slice(0, 40)]),
          kind: "lock",
          text: sanitizeFeedText(notes),
          atMs: parseTimeMs(lock.released_at || lock.claimed_at, nowMs),
          botId: guessBotFromText(`${lock.file} ${lock.owner} ${notes}`),
          source: lock.file,
          glyph: GLYPH.lock,
        });
      }
    }
  } else {
    sources.lock = NO_SOURCE;
  }

  // Commits
  const commits = input.commits ?? [];
  if (commits.length) {
    sources.commit = "git";
    for (const c of commits) {
      const text = sanitizeFeedText(`${c.sha.slice(0, 7)} ${c.subject} · ${c.branch}`);
      push({
        id: stableId(["commit", c.sha, c.branch]),
        kind: "commit",
        text,
        atMs: parseTimeMs(c.date, nowMs),
        botId: guessBotFromText(`${c.branch} ${c.subject}`),
        source: `git:${c.branch}`,
        glyph: GLYPH.commit,
      });
    }
  } else {
    sources.commit = NO_SOURCE;
  }

  // Landings
  const landings: FleetLandingStatus[] = input.fleetPlan?.landings ?? [];
  if (landings.length) {
    sources.landing = "fleet landings";
    for (const L of landings) {
      const hop = L.hops.filter((h: FleetLandingStatus["hops"][number]) => h.reached).map((h: FleetLandingStatus["hops"][number]) => h.hop).join(" → ") || "no hops reached";
      const text = sanitizeFeedText(
        `${L.lane} ${L.mergedIntoDashboard3d ? "landed" : "pending"} · ${hop}${L.tipSha ? ` · ${L.tipSha.slice(0, 7)}` : ""}`,
      );
      push({
        id: stableId(["landing", L.lane, L.tipSha, hop]),
        kind: "landing",
        text,
        atMs: null,
        botId: asBot(L.botId),
        source: L.branch,
        glyph: GLYPH.landing,
      });
    }
  } else {
    sources.landing = NO_SOURCE;
  }

  // Merge Gate — prefer lock notes, else fleet note, else no source
  const mergeLock = (input.locks ?? []).find((l) => /^merge-gate/i.test(l.file) || /merge\s*gate/i.test(l.owner));
  const mergeNote = (mergeLock?.notes || "").trim() || (input.fleetPlan?.mergeGateNote || "").trim();
  if (mergeNote) {
    sources.merge_gate = mergeLock?.file || "fleetPlan.mergeGateNote";
    push({
      id: stableId(["merge_gate", mergeNote.slice(0, 60)]),
      kind: "merge_gate",
      text: sanitizeFeedText(mergeNote),
      atMs: parseTimeMs(mergeLock?.released_at || mergeLock?.claimed_at, nowMs),
      botId: "merge-gate",
      source: sources.merge_gate,
      glyph: GLYPH.merge_gate,
    });
  } else {
    sources.merge_gate = NO_SOURCE;
  }

  // Notion stop-point pages from snapshot
  const graph = input.notionGraph;
  if (graph?.available && graph.pages.length) {
    sources.notion_stop = graph.mode === "unavailable" ? NO_SOURCE : `notion:${graph.mode}`;
    const reverseBot = new Map<string, DashboardBotId>();
    for (const [bot, pageId] of Object.entries(graph.botPageMap || {})) {
      if (BOT_IDS.has(bot)) reverseBot.set(pageId, bot as DashboardBotId);
    }
    let notionCount = 0;
    for (const page of graph.pages) {
      const title = page.title || "";
      const excerpt = page.excerpt || "";
      const blob = `${title}\n${excerpt}`;
      if (!/stop[- ]?point|handoff|landed|stop\b/i.test(blob)) continue;
      const text = sanitizeFeedText(title || excerpt);
      const botId = reverseBot.get(page.id) ?? guessBotFromText(blob);
      const atMs = parseTimeMs(page.lastEdited, nowMs);
      push({
        id: stableId(["notion_stop", page.id, title]),
        kind: "notion_stop",
        text,
        atMs,
        botId,
        source: page.url || page.id,
        glyph: GLYPH.notion_stop,
      });
      notionCount += 1;
      if (notionCount >= 20) break;
    }
    if (!notionCount) sources.notion_stop = NO_SOURCE;
  } else {
    sources.notion_stop = NO_SOURCE;
  }

  // Dedupe by id and by kind+text fingerprint (floods of near-identical rows)
  const seen = new Set<string>();
  const seenFp = new Set<string>();
  let droppedDupes = 0;
  const deduped: FeedEvent[] = [];
  for (const ev of raw) {
    const fp = `${ev.kind}::${ev.text}`;
    if (seen.has(ev.id) || seenFp.has(fp)) {
      droppedDupes += 1;
      continue;
    }
    seen.add(ev.id);
    seenFp.add(fp);
    deduped.push(ev);
  }

  // Rate-limit per kind (keep newest first)
  deduped.sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0) || a.id.localeCompare(b.id));
  const perKind = new Map<FeedKind, number>();
  let droppedFlood = 0;
  const limited: FeedEvent[] = [];
  for (const ev of deduped) {
    const n = perKind.get(ev.kind) ?? 0;
    if (n >= maxPerKind) {
      droppedFlood += 1;
      continue;
    }
    perKind.set(ev.kind, n + 1);
    limited.push(ev);
  }

  const list = limited.slice(0, maxList);
  const events = limited.slice(0, maxGlyphs);

  return {
    events,
    list,
    sources,
    droppedFlood,
    droppedStale,
    droppedDupes,
    generatedAtMs: nowMs,
  };
}
