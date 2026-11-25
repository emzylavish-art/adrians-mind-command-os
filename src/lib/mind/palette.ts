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
    const message = chat.messages.find((item) => item.content.toLowerCase().includes(search));
    if (chat.title.toLowerCase().includes(search) || message) {
      const start = message ? Math.max(0, message.content.toLowerCase().indexOf(search) - 28) : 0;
      rows.push({
        key: chat.id, label: chat.title, meta: chat.humanCode ? "Intelligence" : "Chat",
        view: chat.humanCode ? "code" : "chat", ref: chat.id,
        messageId: message?.id, excerpt: message?.content.slice(start, start + Math.max(search.length, 96)),
      });
    }
  }
  for (const note of input.memories) {
    if (!note.archived && note.text.toLowerCase().includes(search)) {
      rows.push({ key: note.id, label: note.text.slice(0, 80), meta: "Note", view: "memory", ref: note.id });
    }
  }
  for (const file of input.files) {
    if (`${file.name} ${file.text}`.toLowerCase().includes(search)) {
      rows.push({ key: file.id, label: file.name, meta: "File", view: "files", ref: file.id });
    }
  }
  const rank = (row: PaletteHit) => {
    if (row.label.toLowerCase() !== search) return 0;
    return row.ref && (row.view === "chat" || row.view === "code") ? 2 : 1;
  };
  return rows.sort((a, b) => rank(b) - rank(a));
}
