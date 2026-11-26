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
  return search.split(/\s+/).every((word) => normalized.includes(word));
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
  return [item.label, ...(item.aliases ?? [])].join(" ").toLowerCase().includes(search);
}

export type PaletteHit = {
  key: string;
  label: string;
  meta: string;
  view: (typeof PALETTE_DESTINATIONS)[number]["id"];
  ref: string;
  excerpt?: string;
  messageId?: string;
};

type PaletteInput = {
  query: string;
  projects: { id: string; name: string; description: string }[];
  chats: { id: string; title: string; messages: { id?: string; content: string }[]; humanCode?: boolean }[];
  memories: { id: string; text: string; archived: boolean }[];
  files: { id: string; name: string; text: string }[];
  agents: { id: string; name: string; description: string; archived: boolean }[];
  runs: { id: string; goal: string; state: string }[];
};

export function paletteHits(input: PaletteInput): PaletteHit[] {
  const search = input.query.trim().toLowerCase();
  const rows: PaletteHit[] = [];
  for (const item of PALETTE_DESTINATIONS) {
    if (destinationMatches(item, search)) {
      rows.push({ key: `nav-${item.id}`, label: item.label, meta: "Go to", view: item.id, ref: "" });
    }
  }
  if (!search) return rows;
  for (const agent of input.agents) {
    if (agent.archived) continue;
    if (`${agent.name} ${agent.description}`.toLowerCase().includes(search)) {
      rows.push({ key: agent.id, label: agent.name, meta: "Agent", view: "agents", ref: agent.id });
    }
  }
  for (const run of input.runs) {
    if (`${run.goal} ${run.state}`.toLowerCase().includes(search)) {
      rows.push({ key: run.id, label: run.goal.slice(0, 80), meta: `Run · ${run.state}`, view: "runs", ref: run.id });
    }
  }
  for (const project of input.projects) {
    if (`${project.name} ${project.description}`.toLowerCase().includes(search)) {
      rows.push({ key: project.id, label: project.name, meta: "Project", view: "projects", ref: project.id });
    }
  }
  for (const chat of input.chats) {
    const messages = chat.messages.filter((item) => matches(item.content, search));
    const base = { label: chat.title, meta: chat.humanCode ? "Intelligence" : "Chat", view: chat.humanCode ? "code" as const : "chat" as const, ref: chat.id };
    if (matches(chat.title, search) && !messages.length) rows.push({ ...base, key: chat.id });
    messages.forEach((message, index) => rows.push({ ...base, key: `chat-${chat.id}-${message.id ?? index}`, messageId: message.id, excerpt: excerpt(message.content, search) }));
  }
  for (const note of input.memories) {
    if (!note.archived && matches(note.text, search)) {
      rows.push({ key: note.id, label: note.text.slice(0, 80), meta: "Note", view: "memory", ref: note.id, excerpt: excerpt(note.text, search) });
    }
  }
  for (const file of input.files) {
    if (matches(`${file.name} ${file.text}`, search)) {
      rows.push({ key: file.id, label: file.name, meta: "File", view: "files", ref: file.id, excerpt: matches(file.text, search) ? excerpt(file.text, search) : undefined });
    }
  }
  const rank = (row: PaletteHit) => {
    const label = row.label.toLowerCase();
    if (label === search) return row.ref && (row.view === "chat" || row.view === "code") ? 5 : 4;
    if (label.startsWith(search)) return 3;
    if (matches(label, search)) return 2;
    return row.excerpt?.toLowerCase().includes(search) ? 1 : 0;
  };
  return rows.sort((a, b) => rank(b) - rank(a));
}
