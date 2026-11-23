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
  touchesMindOs: false;
  service: "not-running" | "running";
  port: number | null;
  bots: OpenClawBot[];
  skills: string[];
  memory: "local-database";
  awakeRequirement: "Windows must stay awake on AC. This machine cannot set that.";
};

const bots: OpenClawBot[] = [];
const skills: string[] = [];
let service: OpenClawStatus["service"] = "not-running";
let port: number | null = null;

export function resetOpenClawRuntime(): void {
  bots.length = 0;
  skills.length = 0;
  service = "not-running";
  port = null;
}

export function noteOpenClawService(running: boolean, listenPort: number | null): void {
  service = running ? "running" : "not-running";
  port = running && Number.isInteger(listenPort) && (listenPort as number) > 0 ? listenPort : null;
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
    touchesMindOs: false,
    service,
    port,
    bots: bots.map((bot) => ({ ...bot })),
    skills: [...skills],
    memory: "local-database",
    awakeRequirement: "Windows must stay awake on AC. This machine cannot set that.",
  };
}
