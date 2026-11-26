export const PALETTE_DESTINATIONS = [
  { id: "command", label: "Chat" },
  { id: "dashboard", label: "Dashboard" },
  { id: "speak", label: "Speak" },
  { id: "social", label: "Social" },
  { id: "gpt-wrapper", label: "GPT Wrapper" },
  { id: "chat", label: "Thread" },
  { id: "agents", label: "Bots" },
  { id: "runs", label: "Runs" },
  { id: "projects", label: "Projects" },
  { id: "research", label: "Research" },
  { id: "files", label: "Library" },
  { id: "build", label: "Build" },
  { id: "code", label: "Intelligence", aliases: ["human code"] },
  { id: "connected", label: "Plugins", aliases: ["connections", "connected", "MCP"] },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "voice", label: "Voice clone", aliases: ["voice cloning", "clone"] },
  { id: "scheduled", label: "Scheduled" },
  { id: "memory", label: "Memory" },
  { id: "activity", label: "Activity" },
  { id: "help", label: "Help" },
  { id: "settings", label: "Settings" },
] as const;

function matches(text: string, search: string) {
  const normalized = text.toLowerCase();
  const terms = [...search.matchAll(/"([^"\n]+)"|(\S+)/g)].map((term) => term[1] ?? term[2]);
  return terms.every((word) => normalized.includes(word));
}

function excerpt(text: string, search: string) {
  const lower = text.toLowerCase();
  const exact = lower.indexOf(search);
  const index = exact >= 0 ? exact : Math.max(0, lower.indexOf(search.split(/\s+/)[0]!));
  const start = Math.max(0, index - 28);
  return text.slice(start, start + Math.max(search.length + 28, 96));
}

function destinationMatches(item: { label: string; aliases?: readonly string[] }, search: string) {
  if (!search) return true;
  return matches([item.label, ...(item.aliases ?? [])].join(" "), search);
}

export type PaletteHit = {
  key: string;
  label: string;
  meta: string;
  view: (typeof PALETTE_DESTINATIONS)[number]["id"];
  ref: string;
  excerpt?: string;
  messageId?: string;
  focusId?: string;
  rankTime?: string;
  matchCount?: number;
};

type PaletteInput = {
  query: string;
  projects: { id: string; name: string; description: string }[];
  chats: { id: string; title: string; messages: { id?: string; content: string; at?: string }[]; humanCode?: boolean }[];
  memories: { id: string; text: string; archived: boolean }[];
  files: { id: string; name: string; text: string }[];
  agents: { id: string; name: string; description: string; archived: boolean; version?: number }[];
  runs: { id: string; goal: string; state: string }[];
  schedules?: { id: string; name: string; instruction?: string; timeZone: string }[];
  connections?: { id: string; label: string; provider: string; status: string }[];
  browserSessions?: { id: string; title: string; url: string; excerpt: string; lastAction: string }[];
  research?: { id: string; question: string; summary: string; at: string }[];
  deployments?: { id: string; agentId: string; agentVersion: number; target: string; state: string; error: string }[];
  activity?: { id: string; action: string; target: string; result: string; at: string }[];
};

export function paletteHits(input: PaletteInput): PaletteHit[] {
  const search = input.query.trim().toLowerCase().replace(/\s+/g, " ");
  const rows: PaletteHit[] = [];
  for (const item of PALETTE_DESTINATIONS) {
    if (destinationMatches(item, search)) {
      rows.push({ key: `nav-${item.id}`, label: item.label, meta: "Go to", view: item.id, ref: "" });
    }
  }
  if (!search) return rows;
  for (const agent of input.agents) {
    if (agent.archived) continue;
    if (matches(`${agent.name} ${agent.description}`, search)) {
      rows.push({ key: `agent:${agent.id}`, label: agent.name, meta: "Agent", view: "agents", ref: agent.id });
    }
  }
  for (const run of input.runs) {
    if (matches(`${run.goal} ${run.state}`, search)) {
      rows.push({ key: `run:${run.id}`, label: run.goal.slice(0, 80), meta: `Run · ${run.state}`, view: "runs", ref: run.id });
    }
  }
  for (const project of input.projects) {
    if (matches(`${project.name} ${project.description}`, search)) {
      rows.push({ key: `project:${project.id}`, label: project.name, meta: "Project", view: "projects", ref: project.id });
    }
  }
  for (const chat of input.chats) {
    const messages = chat.messages.filter((item) => matches(item.content, search));
    const base = { label: chat.title, meta: chat.humanCode ? "Intelligence" : "Chat", view: chat.humanCode ? "code" as const : "chat" as const, ref: chat.id };
    if (matches(chat.title, search) && !messages.length) rows.push({ ...base, key: `chat:${chat.id}` });
    messages.forEach((message, index) => rows.push({ ...base, key: `chat-${chat.id}-${message.id ?? index}`, messageId: message.id, rankTime: message.at, matchCount: messages.length, excerpt: excerpt(message.content, search) }));
  }
  for (const note of input.memories) {
    if (!note.archived && matches(note.text, search)) {
      rows.push({ key: `memory:${note.id}`, label: note.text.slice(0, 80), meta: "Note", view: "memory", ref: note.id, excerpt: excerpt(note.text, search) });
    }
  }
  for (const file of input.files) {
    if (matches(`${file.name} ${file.text}`, search)) {
      rows.push({ key: `file:${file.id}`, label: file.name, meta: "File", view: "files", ref: file.id, excerpt: matches(file.text, search) ? excerpt(file.text, search) : undefined });
    }
  }
  for (const job of input.schedules ?? []) {
    const content = `${job.name} ${job.instruction ?? ""} ${job.timeZone}`;
    if (matches(content, search)) rows.push({ key: `schedule:${job.id}`, label: job.name, meta: "Schedule", view: "scheduled", ref: job.id, focusId: `schedule-${job.id}`, excerpt: excerpt(content, search) });
  }
  for (const connection of input.connections ?? []) {
    const content = `${connection.label} ${connection.provider} ${connection.status}`;
    if (matches(content, search)) rows.push({ key: `connection:${connection.id}`, label: connection.label, meta: "Connection record", view: "connected", ref: connection.id, focusId: `connection-${connection.id}`, excerpt: excerpt(content, search) });
  }
  for (const session of input.browserSessions ?? []) {
    const content = `${session.title} ${session.url} ${session.excerpt} ${session.lastAction}`;
    if (matches(content, search)) rows.push({ key: `browser:${session.id}`, label: session.title || session.url, meta: "Browser record", view: "tools", ref: session.id, focusId: `browser-${session.id}`, excerpt: excerpt(content, search) });
  }
  for (const report of input.research ?? []) {
    const content = `${report.question} ${report.summary}`;
    if (matches(content, search)) rows.push({ key: `research:${report.id}`, label: report.question, meta: "Research report", view: "research", ref: report.id, focusId: `research-${report.id}`, rankTime: report.at, excerpt: excerpt(content, search) });
  }
  for (const deployment of input.deployments ?? []) {
    const agent = input.agents.find((item) => item.id === deployment.agentId && !item.archived && item.version === deployment.agentVersion);
    if (!agent || input.deployments?.find((item) => item.agentId === agent.id && item.agentVersion === agent.version)?.id !== deployment.id) continue;
    const content = `${agent.name} ${deployment.target} ${deployment.state} ${deployment.error}`;
    if (matches(content, search)) rows.push({ key: `deployment:${deployment.id}`, label: `${agent.name} · ${deployment.target}`, meta: "Deployment record", view: "agents", ref: agent.id, focusId: `deployment-${deployment.id}`, excerpt: excerpt(content, search) });
  }
  for (const entry of input.activity ?? []) {
    const content = `${entry.action.replaceAll("_", " ")} ${entry.target} ${entry.result}`;
    if (matches(content, search)) rows.push({ key: `activity:${entry.id}`, label: entry.action.replaceAll("_", " "), meta: "Activity", view: "activity", ref: entry.id, focusId: `audit-${entry.id}`, rankTime: entry.at, excerpt: excerpt(content, search) });
  }
  const rank = (row: PaletteHit) => {
    const label = row.label.toLowerCase();
    if (label === search) return row.ref && (row.view === "chat" || row.view === "code") ? 5 : 4;
    if (label.startsWith(search)) return 3;
    if (matches(label, search)) return 2;
    return row.excerpt?.toLowerCase().includes(search) ? 1 : 0;
  };
  return rows.sort((a, b) => rank(b) - rank(a) || (b.matchCount ?? 0) - (a.matchCount ?? 0) || (b.rankTime ?? "").localeCompare(a.rankTime ?? "") || a.key.localeCompare(b.key));
}
