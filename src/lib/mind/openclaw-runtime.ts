export type OpenClawBrain = "grok" | "kimi" | "claude" | "ollama-qwen";

export type OpenClawChannel = "telegram" | "whatsapp" | "discord" | "custom";

export type OpenClawBot = {
  id: string;
  channel: OpenClawChannel;
  brain: OpenClawBrain;
  tokenPresent: boolean;
};

export type OpenClawStatus = {
  role: "parallel-worker";
  board: "paperclip";
  touchesMindOs: false;
  service: "not-running" | "running";
  port: number | null;
  startsAfter: "mind-os-engines";
  cpuPriority: "below-mind-os";
  workerThreads: number;
  memoryCeilingMb: number;
  pollIntervalMs: number;
  bots: OpenClawBot[];
  skills: string[];
  memory: "local-database";
  awakeRequirement: "Windows must stay awake on AC. This machine cannot set that.";
};

const MIND_PORTS = new Set([8765, 8766, 9222, 9400]);
const DEFAULT_PORT = 8787;
const DEFAULT_THREADS = 2;
const DEFAULT_MEMORY_MB = 1024;
const DEFAULT_POLL_MS = 15000;

const bots: OpenClawBot[] = [];
const skills: string[] = [];
let service: OpenClawStatus["service"] = "not-running";
let port: number | null = null;
let workerThreads = DEFAULT_THREADS;
let memoryCeilingMb = DEFAULT_MEMORY_MB;
let pollIntervalMs = DEFAULT_POLL_MS;

export function resetOpenClawRuntime(): void {
  bots.length = 0;
  skills.length = 0;
  service = "not-running";
  port = null;
  workerThreads = DEFAULT_THREADS;
  memoryCeilingMb = DEFAULT_MEMORY_MB;
  pollIntervalMs = DEFAULT_POLL_MS;
}

export function configureOpenClawLimits(input: { port: number; workerThreads: number; memoryCeilingMb: number; pollIntervalMs: number }): { ok: true } | { refused: string } {
  if (MIND_PORTS.has(input.port)) return { refused: "OpenClaw cannot use a Mind OS port." };
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) return { refused: "OpenClaw needs its own port." };
  if (!Number.isInteger(input.workerThreads) || input.workerThreads < 1 || input.workerThreads > 2) return { refused: "OpenClaw worker threads stay at 1 or 2." };
  if (!Number.isInteger(input.memoryCeilingMb) || input.memoryCeilingMb < 256 || input.memoryCeilingMb > 1024) return { refused: "OpenClaw memory stays at or under 1024 MB." };
  if (!Number.isInteger(input.pollIntervalMs) || input.pollIntervalMs < 15000) return { refused: "OpenClaw polls no faster than every 15 seconds." };
  port = input.port;
  workerThreads = input.workerThreads;
  memoryCeilingMb = input.memoryCeilingMb;
  pollIntervalMs = input.pollIntervalMs;
  return { ok: true };
}

export function noteOpenClawService(running: boolean, listenPort: number | null): void {
  if (running && (listenPort === null || MIND_PORTS.has(listenPort))) {
    service = "not-running";
    port = null;
    return;
  }
  service = running ? "running" : "not-running";
  port = running ? listenPort : null;
}

export function addOpenClawBot(input: { id: string; channel: OpenClawChannel; brain: OpenClawBrain; token: string }): OpenClawBot | { refused: string } {
  if (!input.id || input.id.length > 64) return { refused: "A bot needs a short id." };
  if (!input.token || input.token.length < 8) return { refused: "A bot needs its own channel token. The token is not stored." };
  const bot = { id: input.id, channel: input.channel, brain: input.brain, tokenPresent: true };
  const existing = bots.findIndex((row) => row.id === bot.id);
  if (existing >= 0) bots[existing] = bot;
  else bots.push(bot);
  return bot;
}

export function loadOpenClawSkills(files: string[]): string[] {
  skills.length = 0;
  for (const file of files) {
    if (file.endsWith("SKILL.md")) skills.push(file);
  }
  return [...skills];
}

export function openClawTurn(botId: string, message: string): { refused: string } | { accepted: true; botId: string } {
  if (service !== "running" || port === null) return { refused: "OpenClaw is not running on this PC." };
  if (!bots.some((bot) => bot.id === botId)) return { refused: "That bot is not configured." };
  if (!message.trim()) return { refused: "There is no message to handle." };
  return { accepted: true, botId };
}

export function openClawStatus(): OpenClawStatus {
  return {
    role: "parallel-worker",
    board: "paperclip",
    touchesMindOs: false,
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
