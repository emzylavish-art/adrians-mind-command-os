import type { DashboardBotId } from "./types.ts";

export type BotDef = {
  id: DashboardBotId;
  name: string;
  ownerMatchers: RegExp[];
  lockMatchers: RegExp[];
  hub?: "orchestrator" | "conductor" | "lane";
};

/** Canonical 14 bots (+ optional Dashboard Bot as 15th). */
export const DASHBOARD_BOTS: BotDef[] = [
  {
    id: "grok-build",
    name: "Grok Build / Orchestrator",
    ownerMatchers: [/^grok\s*build$/i, /^orchestrator$/i],
    lockMatchers: [/^integration\.lock$/i],
    hub: "orchestrator",
  },
  {
    id: "conductor",
    name: "Conductor",
    ownerMatchers: [/^conductor/i],
    lockMatchers: [/^conductor/i],
    hub: "conductor",
  },
  {
    id: "gap-dispatcher",
    name: "Gap Dispatcher",
    ownerMatchers: [/^gap\s*dispatcher/i],
    lockMatchers: [/^gap/i],
    hub: "lane",
  },
  {
    id: "rea-feature-hunter",
    name: "REA Feature Hunter Bot",
    ownerMatchers: [/^rea\s*feature\s*hunter/i],
    lockMatchers: [/^rea-feature-hunter/i],
    hub: "lane",
  },
  {
    id: "merge-gate",
    name: "Merge Gate Bot",
    ownerMatchers: [/^merge\s*gate/i],
    lockMatchers: [/^merge-gate/i],
    hub: "lane",
  },
  {
    id: "visual-polish",
    name: "Visual Polish Bot",
    ownerMatchers: [/^visual\s*polish/i],
    lockMatchers: [/^visual-polish/i],
    hub: "lane",
  },
  {
    id: "logic",
    name: "Logic Bot",
    ownerMatchers: [/^logic\s*bot/i, /^logic\s*bot\s*verifier/i],
    lockMatchers: [/^logic-wiring/i],
    hub: "lane",
  },
  {
    id: "mcp-integration",
    name: "MCP Integration Bot",
    ownerMatchers: [/^mcp\s*integration/i],
    lockMatchers: [/^mcp-integration/i],
    hub: "lane",
  },
  {
    id: "media-integration",
    name: "Media Integration Bot",
    ownerMatchers: [/^media\s*integration/i],
    lockMatchers: [/^media-integration/i],
    hub: "lane",
  },
  {
    id: "voice-integration",
    name: "Voice Integration Bot",
    ownerMatchers: [/^voice\s*integration/i],
    lockMatchers: [/^voice-integration/i],
    hub: "lane",
  },
  {
    id: "voice-wiring",
    name: "Voice Wiring Bot",
    ownerMatchers: [/^voice\s*wiring/i],
    lockMatchers: [/^voice-wiring/i],
    hub: "lane",
  },
  {
    id: "error-banners",
    name: "Error Banners Bot",
    ownerMatchers: [/^error\s*banners/i],
    lockMatchers: [/^error-banners/i],
    hub: "lane",
  },
  {
    id: "xai-verification",
    name: "XAI Verification Bot",
    ownerMatchers: [/^xai\s*verification/i, /^xai\b/i],
    lockMatchers: [/^xai/i],
    hub: "lane",
  },
  {
    id: "hp-pairing",
    name: "HP Pairing Bot",
    ownerMatchers: [/^hp\s*pairing/i],
    lockMatchers: [/^hp-pairing/i, /^pc-pairing/i],
    hub: "lane",
  },
  {
    id: "dashboard",
    name: "Dashboard Bot",
    ownerMatchers: [/^dashboard\s*bot/i],
    lockMatchers: [/^dashboard-3d/i],
    hub: "lane",
  },
];

export function matchBotForLock(file: string, owner: string): BotDef | null {
  for (const bot of DASHBOARD_BOTS) {
    if (bot.lockMatchers.some((re) => re.test(file))) return bot;
    if (owner && bot.ownerMatchers.some((re) => re.test(owner))) return bot;
  }
  return null;
}
