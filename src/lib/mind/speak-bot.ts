import { addCustomAgent, addSchedule, deployAgent, enqueueRun, type FleetTool } from "./fleet.ts";
import type { Workspace } from "./types.ts";

const SAFE_TOOLS: FleetTool[] = ["list_projects", "list_chats", "search_notes"];

export const BOT_STAYS_WHILE_OPEN =
  "This bot is saved and queued. It steps on this device while this page is open. It does not keep running after the tab closes, and it does not run on a computer that is not paired.";

export function parseCreateBot(text: string): { name: string; goal: string } | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!raw) return null;
  if (!/\b(create|make|add|start)\b/.test(lower) || !/\b(bot|agent)\b/.test(lower)) return null;
  if (/\b(image|video|picture|photo|gmail|email)\b/.test(lower)) return null;
  if (/\b(ask|tell|have)\s+(?:my\s+|the\s+)?.+\s+(?:bot|agent)\b/.test(lower)) return null;
  const named = raw.match(/\b(?:named|called)\s+([A-Za-z0-9][A-Za-z0-9 ' -]{0,60})/i);
  const cleaned = named?.[1]?.replace(/\b(for me|please|that|to|and)\b.*$/i, "").replace(/[^\w ' -]/g, "").trim() ?? "";
  return { name: (cleaned || "Spoken bot").slice(0, 80), goal: raw.slice(0, 2000) };
}

export function createBotFromSpeech(
  ws: Workspace,
  text: string,
  now = new Date().toISOString(),
): { ok: true; ws: Workspace; name: string; reply: string } | { ok: false; error: string; ws: Workspace } {
  const parsed = parseCreateBot(text);
  if (!parsed) return { ok: false, error: "That was not a request to create a bot. Nothing was created.", ws };
  if (ws.halted) return { ok: false, error: "Emergency stop is on. No bot was created.", ws };
  const existing = ws.agents.find((agent) => !agent.archived && agent.name.toLowerCase() === parsed.name.toLowerCase());
  if (existing) {
    const scheduled = ws.schedules.some((job) => job.agentId === existing.id && job.enabled)
      ? { ok: true as const, ws }
      : addSchedule(ws, `${existing.name} watch`, existing.id, 5, now);
    if (!scheduled.ok) return { ok: false, error: scheduled.error, ws };
    const deployed = scheduled.ws.deployments.some((item) => item.agentId === existing.id && item.target === "local-worker")
      ? { ok: true as const, ws: scheduled.ws }
      : deployAgent(scheduled.ws, existing.id, "local-worker", now);
    if (!deployed.ok) return { ok: false, error: deployed.error, ws: scheduled.ws };
    const queued = enqueueRun(deployed.ws, existing.id, parsed.goal, now);
    if (!queued.ok) return { ok: false, error: queued.error, ws: deployed.ws };
    return {
      ok: true,
      ws: queued.ws,
      name: existing.name,
      reply: `${existing.name} is already saved and connected to Speak and Intelligence. ${BOT_STAYS_WHILE_OPEN}`,
    };
  }
  const made = addCustomAgent(ws, {
    name: parsed.name,
    description: "Created from Speak or Intelligence. Local tools only.",
    instructions: "You were born inside Adrian's Mind. Work from local notes, chats, and projects. Do not use a secret, do not press the emergency stop, and do not control a computer.",
    tools: SAFE_TOOLS,
    knowledge: "",
  }, now);
  if (!made.ok) return { ok: false, error: made.error, ws };
  const scheduled = addSchedule(made.ws, `${made.agent.name} watch`, made.agent.id, 5, now);
  if (!scheduled.ok) return { ok: false, error: scheduled.error, ws: made.ws };
  const deployed = deployAgent(scheduled.ws, made.agent.id, "local-worker", now);
  if (!deployed.ok) return { ok: false, error: deployed.error, ws: scheduled.ws };
  const queued = enqueueRun(deployed.ws, made.agent.id, parsed.goal, now);
  if (!queued.ok) return { ok: false, error: queued.error, ws: deployed.ws };
  return {
    ok: true,
    ws: queued.ws,
    name: made.agent.name,
    reply: `${made.agent.name} is created and connected to Speak and Intelligence. ${BOT_STAYS_WHILE_OPEN}`,
  };
}
