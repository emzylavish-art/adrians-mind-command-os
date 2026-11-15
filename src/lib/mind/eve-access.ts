export type EveNote = { id: string; text: string };

type AccessWorkspace = {
  halted?: boolean;
  chats?: { title?: string; messages?: { content?: string }[] }[];
  projects?: { name?: string }[];
  files?: { name?: string }[];
  agents?: { name?: string }[];
  connections?: { label?: string; provider?: string; status?: string }[];
  jobs?: { name?: string; enabled?: boolean }[];
  schedules?: { name?: string; enabled?: boolean }[];
};

function clip(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function eveAccessNotes(workspace: AccessWorkspace): EveNote[] {
  const chats = (workspace.chats ?? []).slice(0, 8).map((chat) => {
    const last = [...(chat.messages ?? [])].reverse().find((item) => item.content)?.content ?? "";
    return `${clip(chat.title || "Untitled", 40)}${last ? `: ${clip(last, 80)}` : ""}`;
  });
  const projects = (workspace.projects ?? []).slice(0, 8).map((item) => clip(item.name || "Project", 40));
  const files = (workspace.files ?? []).slice(0, 8).map((item) => clip(item.name || "File", 40));
  const agents = (workspace.agents ?? []).slice(0, 8).map((item) => clip(item.name || "Agent", 40));
  const connections = (workspace.connections ?? []).slice(0, 8).map((item) => `${item.label || item.provider || "Connection"} ${item.status || "unknown"}`);
  const jobs = (workspace.schedules ?? workspace.jobs ?? []).slice(0, 6).map((item) => `${clip(item.name || "Job", 40)} ${item.enabled ? "on" : "off"}`);
  const brief = [
    "EVE can read this workspace. Do not invent items that are not listed.",
    chats.length ? `Chats: ${chats.join(" | ")}` : "Chats: none saved.",
    projects.length ? `Projects: ${projects.join(", ")}` : "Projects: none saved.",
    files.length ? `Files: ${files.join(", ")}` : "Files: none saved.",
    agents.length ? `Agents: ${agents.join(", ")}` : "Agents: none saved.",
    connections.length ? `Connections: ${connections.join(", ")}` : "Connections: none listed.",
    jobs.length ? `Schedules: ${jobs.join(", ")}` : "Schedules: none saved.",
  ].join(" ");
  return [
    { id: "eve-access", text: clip(brief, 1400) },
    { id: "eve-limit", text: "The emergency stop is owner-only. You cannot turn it on, clear it, or bypass it. If it is on, say so and do not act." },
  ];
}
