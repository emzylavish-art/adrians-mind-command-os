export type CommandMode = "ask" | "research" | "agent" | "build";

export type CommandIntent =
  | { kind: "chat" }
  | { kind: "blocked"; area: "gmail" | "search" | "media" | "build" | "device"; reply: string }
  | { kind: "notion" }
  | { kind: "mcp" }
  | { kind: "skill" }
  | { kind: "local"; tool: "list_projects" | "list_chats" | "search_notes" | "list_schedules" | "run_due_schedules" }
  | { kind: "bot"; agentId: string; agentName: string; goal: string }
  | { kind: "bot_missing"; reply: string };

const REPLIES = {
  gmail: "No Gmail account is connected. Nothing was read or sent.",
  search: "No search provider is configured. Nothing was searched and no citations were created.",
  media: "Image and video generation are not called. Nothing was created.",
  build: "Adrian Build cannot edit a repository, run a terminal, or commit from this page. No files were changed.",
  device: "No computer is paired. Nothing ran on a laptop or phone.",
} as const;

export function interpretCommand(
  text: string,
  agents: { id: string; name: string; archived: boolean }[],
  mode: CommandMode = "ask",
): CommandIntent {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!raw) return { kind: "chat" };

  if (/\b(gmail|inbox|my emails|send an email|draft an email|check email)\b/.test(lower)) {
    return { kind: "blocked", area: "gmail", reply: REPLIES.gmail };
  }
  if (/\b(generate|make|create)\b.{0,40}\b(image|video|picture|photo)\b/.test(lower)) {
    return { kind: "blocked", area: "media", reply: REPLIES.media };
  }
  if (/\b(elitebook|my computer|my laptop|terminal|git commit|git push|pull request)\b/.test(lower)) {
    return { kind: "blocked", area: "device", reply: REPLIES.device };
  }
  if (mode === "build") return { kind: "blocked", area: "build", reply: REPLIES.build };
  if (mode === "research" && !/\bnotes\b/.test(lower)) return { kind: "blocked", area: "search", reply: REPLIES.search };
  if (/\b(search the web|web search|look (this|it) up online)\b/.test(lower)) {
    return { kind: "blocked", area: "search", reply: REPLIES.search };
  }

  const askBot = lower.match(/\b(?:ask|tell|have)\s+(?:my\s+|the\s+)?(.+?)\s+(?:bot|agent)\b/);
  if (askBot?.[1]) {
    const wanted = askBot[1].trim();
    const found = agents.find((agent) => !agent.archived && agent.name.toLowerCase().includes(wanted));
    if (!found) return { kind: "bot_missing", reply: `No saved bot matches “${wanted.slice(0, 80)}”. Nothing was queued.` };
    return { kind: "bot", agentId: found.id, agentName: found.name, goal: raw.slice(0, 2000) };
  }

  if (/\bnotion\b/.test(lower)) return { kind: "notion" };
  if (/\bmcp\b/.test(lower)) return { kind: "mcp" };
  if (/\bskills?\b/.test(lower)) return { kind: "skill" };

  if (mode === "agent") {
    const found = agents.find((agent) => !agent.archived);
    if (!found) return { kind: "bot_missing", reply: "No bot is saved on this device. Nothing was queued." };
    return { kind: "bot", agentId: found.id, agentName: found.name, goal: raw.slice(0, 2000) };
  }

  if (/\brun due schedules\b/.test(lower)) return { kind: "local", tool: "run_due_schedules" };
  if (/\b(list|show)\s+(my\s+)?schedules\b/.test(lower)) return { kind: "local", tool: "list_schedules" };
  if (/\b(list|show)\s+(my\s+)?projects\b/.test(lower)) return { kind: "local", tool: "list_projects" };
  if (/\b(list|show)\s+(my\s+)?(chats|conversations)\b/.test(lower)) return { kind: "local", tool: "list_chats" };
  if (/\bsearch\s+(my\s+)?notes\b/.test(lower)) return { kind: "local", tool: "search_notes" };
  return { kind: "chat" };
}
