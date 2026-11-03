/**
 * Queue #27 / Gap#5 — constellation Filters & Groups (search, orphans, lane/health).
 * Pure matchers only; never invent bots.
 */
import { LANE_DEFS, type LaneId } from "./constellations.ts";
import type { BotNode, DashboardBotId, Health } from "./types.ts";
import type { ConstellationEdge } from "./constellations.ts";

export type GraphFilterState = {
  query: string;
  orphansOnly: boolean;
  health: Health | "all";
  lane: LaneId | "all";
};

export const DEFAULT_GRAPH_FILTER: GraphFilterState = {
  query: "",
  orphansOnly: false,
  health: "all",
  lane: "all",
};

export function sanitizeGraphQuery(q: unknown): string {
  return String(q ?? "").trim().slice(0, 80).toLowerCase();
}

export function connectedBotIds(edges: readonly ConstellationEdge[]): Set<string> {
  const s = new Set<string>();
  for (const e of edges) {
    s.add(e.from);
    s.add(e.to);
  }
  return s;
}

export function laneIdForBot(botId: string): LaneId | null {
  for (const lane of LANE_DEFS) {
    if (lane.botIds.includes(botId as DashboardBotId)) return lane.id;
  }
  return null;
}

export function botMatchesGraphFilter(
  bot: BotNode,
  filter: GraphFilterState,
  connected: Set<string>,
): boolean {
  if (filter.health !== "all" && bot.health !== filter.health) return false;
  if (filter.lane !== "all") {
    const lane = laneIdForBot(bot.id);
    if (lane !== filter.lane) return false;
  }
  if (filter.orphansOnly && connected.has(bot.id)) return false;
  const q = sanitizeGraphQuery(filter.query);
  if (q) {
    const hay = `${bot.id} ${bot.name} ${bot.branch ?? ""} ${bot.notes ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function filterBotIds(
  bots: readonly BotNode[],
  edges: readonly ConstellationEdge[],
  filter: GraphFilterState,
): Set<string> {
  const connected = connectedBotIds(edges);
  const out = new Set<string>();
  for (const b of bots) {
    if (botMatchesGraphFilter(b, filter, connected)) out.add(b.id);
  }
  return out;
}

export function laneOptions(): Array<{ id: LaneId | "all"; name: string }> {
  return [{ id: "all", name: "All lanes" }, ...LANE_DEFS.map((l) => ({ id: l.id, name: l.name }))];
}
