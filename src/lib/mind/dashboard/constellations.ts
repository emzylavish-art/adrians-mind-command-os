import type { BotNode, DashboardBotId, Health } from "./types.ts";

export type LaneId =
  | "orchestrator"
  | "conductor"
  | "dispatch"
  | "rea"
  | "merge"
  | "visual"
  | "logic"
  | "mcp"
  | "media"
  | "voice"
  | "errors"
  | "xai"
  | "pairing"
  | "dashboard"
  | "visual-fleet";

export type Constellation = {
  id: LaneId;
  name: string;
  botIds: DashboardBotId[];
  center: [number, number, number];
  health: Health;
};

export type ConstellationEdge = {
  from: DashboardBotId;
  to: DashboardBotId;
  kind: "lane" | "hub";
  health: Health;
};

export const LANE_DEFS: Array<{
  id: LaneId;
  name: string;
  botIds: DashboardBotId[];
  center: [number, number, number];
}> = [
  { id: "orchestrator", name: "Orchestrator", botIds: ["grok-build"], center: [0, 1.2, 0] },
  { id: "conductor", name: "Conductor", botIds: ["conductor"], center: [-3.5, 0.8, 1.5] },
  { id: "dispatch", name: "Gap Dispatch", botIds: ["gap-dispatcher"], center: [3.8, 0.6, 1.2] },
  { id: "rea", name: "REA Hunt", botIds: ["rea-feature-hunter"], center: [-5.5, -0.2, -2] },
  { id: "merge", name: "Merge Gate", botIds: ["merge-gate"], center: [5.2, -0.4, -1.5] },
  { id: "visual", name: "Visual Polish", botIds: ["visual-polish"], center: [-2.2, -1.5, 4.2] },
  { id: "logic", name: "Logic", botIds: ["logic"], center: [2.4, -1.2, 4] },
  { id: "mcp", name: "MCP", botIds: ["mcp-integration"], center: [-6, 1.5, 2.5] },
  { id: "media", name: "Media", botIds: ["media-integration"], center: [6.2, 1.2, 2.2] },
  { id: "voice", name: "Voice", botIds: ["voice-integration", "voice-wiring"], center: [-4.5, 2.5, -4] },
  { id: "errors", name: "Error Banners", botIds: ["error-banners"], center: [4.2, 2.2, -3.8] },
  { id: "xai", name: "xAI Verify", botIds: ["xai-verification"], center: [0.5, -3, -5] },
  { id: "pairing", name: "HP Pairing", botIds: ["hp-pairing"], center: [-1.5, -2.8, 5.5] },
  { id: "dashboard", name: "Dashboard", botIds: ["dashboard"], center: [0, -4.5, 0] },
  {
    id: "visual-fleet",
    name: "Visual Fleet",
    botIds: ["cosmos-painter", "cosmos-light", "cosmos-motion"],
    center: [8.5, -2.2, -6.5],
  },
];

const HEALTH_RANK: Record<Health, number> = {
  blocked: 3,
  stalled: 2,
  healthy: 1,
  idle: 0,
};

export function laneHealth(bots: BotNode[], botIds: DashboardBotId[]): Health {
  let worst: Health = "idle";
  for (const id of botIds) {
    const bot = bots.find((b) => b.id === id);
    if (!bot) continue;
    if (HEALTH_RANK[bot.health] > HEALTH_RANK[worst]) worst = bot.health;
  }
  return worst;
}

export function buildConstellations(bots: BotNode[]): Constellation[] {
  return LANE_DEFS.map((lane) => ({
    id: lane.id,
    name: lane.name,
    botIds: [...lane.botIds],
    center: [...lane.center] as [number, number, number],
    health: laneHealth(bots, lane.botIds),
  }));
}

export function constellationEdges(bots: BotNode[]): ConstellationEdge[] {
  const edges: ConstellationEdge[] = [];
  const byId = new Map(bots.map((b) => [b.id, b] as const));
  const seen = new Set<string>();
  const push = (from: DashboardBotId, to: DashboardBotId, kind: "lane" | "hub", health: Health) => {
    const key = [from, to].sort().join(">");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind, health });
  };

  for (const lane of LANE_DEFS) {
    const present = lane.botIds.filter((id) => byId.has(id));
    for (let i = 0; i < present.length - 1; i++) {
      const a = present[i]!;
      const b = present[i + 1]!;
      const ha = byId.get(a)!.health;
      const hb = byId.get(b)!.health;
      const health = HEALTH_RANK[ha] >= HEALTH_RANK[hb] ? ha : hb;
      push(a, b, "lane", health);
    }
    if (lane.id !== "orchestrator" && present[0] && byId.has("grok-build")) {
      push("grok-build", present[0]!, "hub", byId.get(present[0]!)!.health);
    }
  }
  return edges;
}

export function botWorldPosition(botId: DashboardBotId, indexInLane = 0): [number, number, number] {
  const lane = LANE_DEFS.find((l) => l.botIds.includes(botId));
  if (!lane) return [0, 0, 0];
  const [cx, cy, cz] = lane.center;
  if (lane.botIds.length === 1) return [cx, cy, cz];
  const idx = Math.max(0, lane.botIds.indexOf(botId));
  const angle = (idx / lane.botIds.length) * Math.PI * 2;
  const r = 0.85 + indexInLane * 0.1;
  return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * 0.35, cz + Math.sin(angle) * r];
}

export function systemWeather(bots: BotNode[]): { label: string; tone: Health; summary: string } {
  const counts = { healthy: 0, stalled: 0, blocked: 0, idle: 0 };
  for (const b of bots) counts[b.health] += 1;
  if (counts.blocked > 0) {
    return {
      label: "Storm front",
      tone: "blocked",
      summary: `${counts.blocked} blocked · ${counts.stalled} stalled · ${counts.healthy} healthy`,
    };
  }
  if (counts.stalled > counts.healthy) {
    return {
      label: "Slow drift",
      tone: "stalled",
      summary: `${counts.stalled} stalled · ${counts.healthy} healthy · ${counts.idle} idle`,
    };
  }
  if (counts.healthy > 0) {
    return {
      label: "Clear skies",
      tone: "healthy",
      summary: `${counts.healthy} healthy · ${counts.stalled} stalled · ${counts.idle} idle`,
    };
  }
  return { label: "Quiet void", tone: "idle", summary: `${counts.idle} idle · no active claims` };
}
