/**
 * Queue #9 — Notion mirror readback from snapshot (pure / client-safe).
 * Per-bot stop-points, freshness, stale marker. Never invents pages.
 */
import { parseTimeMs, sanitizeLabelText } from "./health.ts";
import type { DashboardBotId, BotNode } from "./types.ts";
import type { NotionGraph, NotionSnapPage } from "./notion-graph-core.ts";
import { pageForBot } from "./notion-graph-core.ts";

export const NO_MIRROR_SOURCE = "no source yet";
export const STALE_MIRROR_MS = 6 * 60 * 60 * 1000; // 6h WAT wall clock via ms delta

export type NotionMirrorRow = {
  botId: DashboardBotId;
  botName: string;
  pageId: string | null;
  title: string | null;
  url: string | null;
  lastEdited: string | null;
  lastEditedMs: number | null;
  ageMs: number | null;
  stale: boolean;
  freshLabel: string;
  excerpt: string | null;
  source: string;
};

export type NotionMirrorView = {
  available: boolean;
  reason: string | null;
  mode: NotionGraph["mode"] | "unavailable";
  generatedAt: string | null;
  rows: NotionMirrorRow[];
  staleCount: number;
  mappedCount: number;
};

function looksLikeStop(page: NotionSnapPage): boolean {
  const blob = `${page.title}\n${page.excerpt}`;
  return /stop[- ]?point|handoff|landed|\bstop\b/i.test(blob);
}

export function freshnessLabel(ageMs: number | null, stale: boolean): string {
  if (ageMs == null) return "unknown age";
  if (stale) return "stale";
  const min = Math.round(ageMs / 60000);
  if (min < 60) return `${min}m fresh`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h fresh`;
  return `${Math.round(hr / 24)}d fresh`;
}

export function buildNotionMirrorView(input: {
  bots: readonly BotNode[];
  graph: NotionGraph | null | undefined;
  nowMs?: number;
  staleMs?: number;
}): NotionMirrorView {
  const nowMs = Number.isFinite(input.nowMs) ? (input.nowMs as number) : Date.now();
  const staleMs = Number.isFinite(input.staleMs) ? (input.staleMs as number) : STALE_MIRROR_MS;
  const graph = input.graph;

  if (!graph || !graph.available) {
    return {
      available: false,
      reason: graph?.reason || NO_MIRROR_SOURCE,
      mode: graph?.mode ?? "unavailable",
      generatedAt: graph?.generatedAt ?? null,
      rows: [],
      staleCount: 0,
      mappedCount: 0,
    };
  }

  const rows: NotionMirrorRow[] = [];
  let staleCount = 0;
  let mappedCount = 0;

  for (const bot of input.bots) {
    const page = pageForBot(graph, bot.id);
    if (!page) {
      // No Notion page mapped — surface real lock/notes content when present (never invent pages).
      const lock = bot.lock;
      const hbRaw =
        lock?.raw && typeof lock.raw === "object"
          ? String((lock.raw as Record<string, unknown>).heartbeat_at ?? (lock.raw as Record<string, unknown>).heartbeatAt ?? "")
          : "";
      const hb = hbRaw || lock?.claimed_at || bot.lastActivityAt || null;
      const hbMs = parseTimeMs(hb, nowMs);
      const ageMs = hbMs != null ? Math.max(0, nowMs - hbMs) : null;
      const notes = sanitizeLabelText(bot.notes || lock?.notes || "", 140) || null;
      const task =
        lock?.raw && typeof lock.raw === "object"
          ? sanitizeLabelText(String((lock.raw as Record<string, unknown>).task ?? ""), 100) || null
          : null;
      const hasLockContent = Boolean(lock || notes || task || hb);
      rows.push({
        botId: bot.id,
        botName: sanitizeLabelText(bot.name, 80),
        pageId: null,
        title: hasLockContent ? task || notes || `${lock?.status ?? "lock"} · ${lock?.file ?? "unmapped"}` : null,
        url: null,
        lastEdited: hb,
        lastEditedMs: hbMs,
        ageMs,
        stale: ageMs != null ? ageMs > staleMs : false,
        freshLabel: hasLockContent
          ? ageMs != null
            ? `lock · ${freshnessLabel(ageMs, ageMs > staleMs)}`
            : "lock · no Notion page"
          : NO_MIRROR_SOURCE,
        excerpt: notes,
        source: hasLockContent ? "lock" : graph.mode,
      });
      continue;
    }
    mappedCount += 1;
    // Prefer mapped page; note if it doesn't look like a stop-point (still real)
    const lastEditedMs = parseTimeMs(page.lastEdited, nowMs);
    const ageMs = lastEditedMs != null ? Math.max(0, nowMs - lastEditedMs) : null;
    const stale = ageMs != null ? ageMs > staleMs : !page.lastEdited;
    if (stale) staleCount += 1;
    const title = sanitizeLabelText(page.title || page.id, 100);
    const stopHint = looksLikeStop(page) ? "" : " (mapped page)";
    rows.push({
      botId: bot.id,
      botName: sanitizeLabelText(bot.name, 80),
      pageId: page.id,
      title: title + stopHint,
      url: page.url || null,
      lastEdited: page.lastEdited,
      lastEditedMs,
      ageMs,
      stale,
      freshLabel: freshnessLabel(ageMs, stale),
      excerpt: sanitizeLabelText(page.excerpt || "", 140) || null,
      source: `notion:${graph.mode}`,
    });
  }

  return {
    available: true,
    reason: null,
    mode: graph.mode,
    generatedAt: graph.generatedAt,
    rows,
    staleCount,
    mappedCount,
  };
}
