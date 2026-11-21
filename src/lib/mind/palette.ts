export const PALETTE_DESTINATIONS = [
  { id: "command", label: "Chat" },
  { id: "chat", label: "Thread" },
  { id: "agents", label: "Bots" },
  { id: "runs", label: "Runs" },
  { id: "projects", label: "Projects" },
  { id: "research", label: "Research" },
  { id: "files", label: "Library" },
  { id: "build", label: "Build" },
  { id: "code", label: "Intelligence", aliases: ["human code"] },
  { id: "connected", label: "Connected" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
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
};

type PaletteInput = {
  query: string;
  projects: { id: string; name: string; description: string }[];
  chats: { id: string; title: string; messages: { content: string }[]; humanCode?: boolean }[];
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
    const blob = `${chat.title} ${chat.messages.map((msg) => msg.content).join(" ")}`.toLowerCase();
    if (blob.includes(search)) {
      rows.push({ key: chat.id, label: chat.title, meta: chat.humanCode ? "Intelligence" : "Chat", view: chat.humanCode ? "code" : "chat", ref: chat.id });
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
  return rows.slice(0, 16);
}
