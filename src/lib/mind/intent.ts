import { parseCreateBot } from "./speak-bot.ts";

export type CommandMode = "ask" | "research" | "agent" | "build";

export type CommandIntent =
  | { kind: "chat" }
  | { kind: "blocked"; area: "gmail" | "search" | "media" | "build" | "device"; reply: string }
  | { kind: "web_research"; query: string }
  | { kind: "notion" }
  | { kind: "mcp" }
  | { kind: "skill" }
  | { kind: "save_skill" }
  | { kind: "local"; tool: "list_projects" | "list_chats" | "search_notes" | "list_schedules" | "run_due_schedules" }
  | { kind: "bot"; agentId: string; agentName: string; goal: string }
  | { kind: "create_bot"; name: string; goal: string }
  | { kind: "bot_missing"; reply: string };

const REPLIES = {
  gmail: "Mailbox reading and sending are not available in ordinary chat. Open Plugins to check Gmail authorization. Nothing was read or sent.",
  search: "No search provider is configured. Nothing was searched and no citations were created.",
  media: "Image and video generation are not called. Nothing was created.",
  build: "Adrian Build cannot edit a repository, run a terminal, or commit from this page. No files were changed.",
  device: "No computer is paired. Nothing ran on a laptop or phone.",
} as const;

export function interpretCommand(
  text: string,
  agents: { id: string; name: string; archived: boolean }[],
  mode: CommandMode = "ask",
  connections?: { gmail?: { authorizationSaved: boolean } },
): CommandIntent {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!raw) return { kind: "chat" };
  const created = parseCreateBot(raw);
  if (created) return { kind: "create_bot", name: created.name, goal: created.goal };

  const informationOrDraft = /^(?:please\s+)?(?:explain|describe|what\b|why\b|how\b|write\s+(?:me\s+)?(?:an?\s+)?email|draft\b|compose\b)/.test(lower);
  const mailboxAction = /\b(?:check|read|summari[sz]e|search|find|open|delete|archive)\b.{0,50}\b(?:gmail|inbox|my emails|my mail|email)\b|\bsend\b.{0,35}\b(?:email|mail|gmail)\b/.test(lower);
  if (!informationOrDraft && mailboxAction) {
    const gmail = connections?.gmail;
    const reply = gmail?.authorizationSaved
      ? "Gmail authorization is saved, but mailbox reading and sending are not implemented in ordinary chat. Nothing was read or sent."
      : gmail ? "Gmail authorization is required for mailbox access. Reading and sending are not implemented in ordinary chat. Nothing was read or sent."
      : REPLIES.gmail;
    return { kind: "blocked", area: "gmail", reply };
  }
  if (/\b(generate|make|create)\b.{0,40}\b(image|video|picture|photo)\b/.test(lower)) {
    return { kind: "blocked", area: "media", reply: REPLIES.media };
  }
  if (/\b(elitebook|my computer|my laptop|terminal|git commit|git push|pull request)\b/.test(lower)) {
    return { kind: "blocked", area: "device", reply: REPLIES.device };
  }
  if (mode === "build") return { kind: "blocked", area: "build", reply: REPLIES.build };
  if (mode === "research" && !/\bnotes\b/.test(lower)) {
    return { kind: "web_research", query: raw.slice(0, 300) };
  }
  if (/\b(search the web|web search|look (this|it) up online)\b/.test(lower)) {
    return { kind: "web_research", query: raw.slice(0, 300) };
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
  if (/turn (this|that) into a reusable skill/.test(lower) || /make this a reusable skill/.test(lower)) return { kind: "save_skill" };
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
