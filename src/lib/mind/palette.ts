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

export function searchTerms(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}_+#.-]+/gu) ?? [];
}
export function searchScore(label: string, content: string, query: string): number {
  const terms = searchTerms(query); if (!terms.length) return 1;
  const title = searchTerms(label).join(" "); const body = searchTerms(content).join(" ");
  const queryText = terms.join(" ");
  if (!terms.every((term) => `${title} ${body}`.includes(term))) return 0;
  return (title === queryText ? 1000 : title.startsWith(queryText) ? 300 : title.includes(queryText) ? 150 : 0) + terms.filter((term) => title.split(" ").includes(term)).length * 40 + (body.includes(queryText) ? 10 : 1);
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

export type PaletteInput = {
  filter?: PaletteHit["view"] | "all";
  schedules?: { id: string; goal?: string; task?: string; prompt?: string; name?: string; enabled: boolean }[];
  research?: { id: string; question: string; summary: string; at?: string }[];
  activity?: { id: string; action: string; target: string; result: string; at?: string }[];
  connections?: { id: string; name?: string; label?: string; status?: string; state?: string }[];
  skills?: { id: string; name: string; description?: string }[];
  query: string;
  projects: { id: string; name: string; description: string }[];
  chats: { id: string; title: string; messages: { id?: string; content: string; at?: string }[]; humanCode?: boolean }[];
  memories: { id: string; text: string; archived: boolean }[];
  files: { id: string; name: string; text: string }[];
  agents: { id: string; name: string; description: string; archived: boolean }[];
  runs: { id: string; goal: string; state: string }[];
};

export function paletteHits(input: PaletteInput): PaletteHit[] {
  const search = input.query.trim();
  const rows: (PaletteHit & { score: number; at?: string })[] = [];
  const add = (row: PaletteHit, content = "", at?: string) => {
    const score = searchScore(row.label, content, search);
    if (score && (!input.filter || input.filter === "all" || input.filter === row.view)) rows.push({ ...row, score, at });
  };
  for (const item of PALETTE_DESTINATIONS) add({ key: `nav-${item.id}`, label: item.label, meta: "Go to", view: item.id, ref: "" }, "aliases" in item ? item.aliases.join(" ") : "");
  if (!search) return rows;
  for (const agent of input.agents) if (!agent.archived) add({ key: `agent:${agent.id}`, label: agent.name, meta: "Agent", view: "agents", ref: agent.id }, agent.description);
  for (const run of input.runs) add({ key: `run:${run.id}`, label: run.goal.slice(0, 100), meta: `Run · ${run.state}`, view: "runs", ref: run.id }, `${run.goal} ${run.state}`);
  for (const project of input.projects) add({ key: `project:${project.id}`, label: project.name, meta: "Project", view: "projects", ref: project.id }, project.description);
  for (const chat of input.chats) {
    const messages = chat.messages.filter((message) => searchScore("", message.content, search) > 0);
    if (!messages.length) add({ key: `chat:${chat.id}`, label: chat.title, meta: chat.humanCode ? "Intelligence" : "Chat", view: chat.humanCode ? "code" : "chat", ref: chat.id });
    for (const message of messages) {
      const normalized = message.content.toLowerCase(); const first = searchTerms(search)[0] ?? "";
      const start = Math.max(0, normalized.indexOf(first) - 28);
      add({ key: `chat:${chat.id}:message:${message.id ?? chat.messages.indexOf(message)}`, label: chat.title, meta: chat.humanCode ? "Intelligence" : "Chat", view: chat.humanCode ? "code" : "chat", ref: chat.id, messageId: message.id, excerpt: message.content.slice(start, start + 160) }, message.content, message.at);
    }
  }
  for (const note of input.memories) if (!note.archived) add({ key: `memory:${note.id}`, label: note.text.slice(0, 100), meta: "Note", view: "memory", ref: note.id }, note.text);
  for (const file of input.files) add({ key: `file:${file.id}`, label: file.name, meta: "File", view: "files", ref: file.id }, file.text);
  for (const job of input.schedules ?? []) add({ key: `schedule:${job.id}`, label: job.name || (job.goal || job.task || job.prompt || "Scheduled task").slice(0, 100), meta: `Schedule · ${job.enabled ? "enabled" : "paused"}`, view: "scheduled", ref: job.id }, job.goal || job.task || job.prompt || "");
  for (const report of input.research ?? []) add({ key: `research:${report.id}`, label: report.question, meta: "Research report", view: "research", ref: report.id }, report.summary, report.at);
  for (const item of input.activity ?? []) add({ key: `activity:${item.id}`, label: item.action.replace(/_/g, " "), meta: "Activity", view: "activity", ref: item.id }, `${item.target} ${item.result}`, item.at);
  for (const item of input.connections ?? []) add({ key: `connection:${item.id}`, label: item.label || item.name || item.id, meta: "Connection", view: "connected", ref: item.id }, `${item.status || item.state || ""}`);
  for (const item of input.skills ?? []) add({ key: `skill:${item.id}`, label: item.name, meta: "Skill", view: "skills", ref: item.id }, item.description);
  return rows.sort((a, b) => b.score - a.score || Date.parse(b.at || "1970-01-01") - Date.parse(a.at || "1970-01-01") || a.key.localeCompare(b.key));
}
