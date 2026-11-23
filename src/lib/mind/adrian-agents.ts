export type AgentChannel = "telegram" | "whatsapp" | "discord" | "custom";

export type AgentBot = {
  id: string;
  channel: AgentChannel;
  brain: string;
  tokenPresent: boolean;
};

export type AgentStatus = {
  product: "Adrian's Mind";
  role: "bots-and-agents";
  board: "paperclip";
  service: "not-running" | "running";
  port: number | null;
  startsAfter: "mind-os-engines";
  cpuPriority: "below-mind-os";
  workerThreads: number;
  memoryCeilingMb: number;
  pollIntervalMs: number;
  bots: AgentBot[];
  skills: string[];
  memory: "local-database";
  awakeRequirement: "Windows must stay awake on AC. This machine cannot set that.";
};

const MIND_PORTS = new Set([8765, 8766, 9222, 9400]);
const DEFAULT_THREADS = 2;
const DEFAULT_MEMORY_MB = 1024;
const DEFAULT_POLL_MS = 15000;

const bots: AgentBot[] = [];
const skills: string[] = [];
let connected: string[] = [];
let service: AgentStatus["service"] = "not-running";
let port: number | null = null;
let workerThreads = DEFAULT_THREADS;
let memoryCeilingMb = DEFAULT_MEMORY_MB;
let pollIntervalMs = DEFAULT_POLL_MS;

export function resetAgentRuntime(): void {
  bots.length = 0;
  skills.length = 0;
  connected = [];
  service = "not-running";
  port = null;
  workerThreads = DEFAULT_THREADS;
  memoryCeilingMb = DEFAULT_MEMORY_MB;
  pollIntervalMs = DEFAULT_POLL_MS;
}

export function setConnectedBrains(names: string[]): string[] {
  connected = names.filter((name) => name.trim().length > 0);
  return [...connected];
}

export function selectConnectedBrain(requested: string): { brain: string } | { refused: string } {
  if (!connected.includes(requested)) return { refused: "That API is not connected." };
  return { brain: requested };
}

export function configureAgentLimits(input: { port: number; workerThreads: number; memoryCeilingMb: number; pollIntervalMs: number }): { ok: true } | { refused: string } {
  if (MIND_PORTS.has(input.port)) return { refused: "Adrian's Mind agents cannot use a Mind OS port." };
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) return { refused: "Adrian's Mind agents need their own port." };
  if (!Number.isInteger(input.workerThreads) || input.workerThreads < 1 || input.workerThreads > 2) return { refused: "Agent worker threads stay at 1 or 2." };
  if (!Number.isInteger(input.memoryCeilingMb) || input.memoryCeilingMb < 256 || input.memoryCeilingMb > 1024) return { refused: "Agent memory stays at or under 1024 MB." };
  if (!Number.isInteger(input.pollIntervalMs) || input.pollIntervalMs < 15000) return { refused: "Agents poll no faster than every 15 seconds." };
  port = input.port;
  workerThreads = input.workerThreads;
  memoryCeilingMb = input.memoryCeilingMb;
  pollIntervalMs = input.pollIntervalMs;
  return { ok: true };
}

export function noteAgentService(running: boolean, listenPort: number | null): void {
  if (running && (listenPort === null || MIND_PORTS.has(listenPort))) {
    service = "not-running";
    port = null;
    return;
  }
  service = running ? "running" : "not-running";
  port = running ? listenPort : null;
}

export function addAgentBot(input: { id: string; channel: AgentChannel; brain: string; token: string }): AgentBot | { refused: string } {
  const selected = selectConnectedBrain(input.brain);
  if ("refused" in selected) return selected;
  if (!input.id || input.id.length > 64) return { refused: "A bot needs a short id." };
  if (!input.token || input.token.length < 8) return { refused: "A bot needs its own channel token. The token is not stored." };
  const bot = { id: input.id, channel: input.channel, brain: selected.brain, tokenPresent: true };
  const existing = bots.findIndex((row) => row.id === bot.id);
  if (existing >= 0) bots[existing] = bot;
  else bots.push(bot);
  return bot;
}

export function loadAgentSkills(files: string[]): string[] {
  skills.length = 0;
  for (const file of files) {
    if (file.endsWith("SKILL.md")) skills.push(file);
  }
  return [...skills];
}

export function agentTurn(botId: string, message: string): { refused: string } | { accepted: true; botId: string; brain: string } {
  if (service !== "running" || port === null) return { refused: "Adrian's Mind agents are not running on this PC." };
  const bot = bots.find((row) => row.id === botId);
  if (!bot) return { refused: "That bot is not configured." };
  if (!message.trim()) return { refused: "There is no message to handle." };
  return { accepted: true, botId, brain: bot.brain };
}

export function agentStatus(): AgentStatus {
  return {
    product: "Adrian's Mind",
    role: "bots-and-agents",
    board: "paperclip",
    service,
    port: service === "running" ? port : null,
    startsAfter: "mind-os-engines",
    cpuPriority: "below-mind-os",
    workerThreads,
    memoryCeilingMb,
    pollIntervalMs,
    bots: bots.map((bot) => ({ ...bot })),
    skills: [...skills],
    memory: "local-database",
    awakeRequirement: "Windows must stay awake on AC. This machine cannot set that.",
  };
}
