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

export function searchTerms(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}_+#.-]+/gu) ?? [];
}

type IndexedPaletteDocument = {
  hit: PaletteHit;
  searchText: string;
  labelText: string;
  /** Chat-title ranking is independent of project-context matching. */
  titleText?: string;
  excerptText?: string;
};

export type PaletteSearchIndex = {
  readonly documents: readonly IndexedPaletteDocument[];
  readonly navigation: readonly PaletteHit[];
};
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
  projectId?: string | null;
  archived?: boolean;
  temporary?: boolean;
  rank?: number;
};

export type PaletteData = {
  projects: { id: string; name: string; description: string }[];
  chats: { id: string; title: string; messages: { id?: string; content: string }[]; humanCode?: boolean; projectId?: string | null; archived?: boolean; temporary?: boolean; updatedAt?: string }[];
  memories: { id: string; text: string; archived: boolean }[];
  files: { id: string; name: string; text: string; projectId?: string | null }[];
  agents: { id: string; name: string; description: string; archived: boolean }[];
  runs: { id: string; goal: string; state: string }[];
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
  agents: { id: string; name: string; description: string; archived: boolean; version?: number }[];
  runs: { id: string; goal: string; state: string }[];
  schedules?: { id: string; name: string; instruction?: string; timeZone: string }[];
  connections?: { id: string; label: string; provider: string; status: string }[];
  browserSessions?: { id: string; title: string; url: string; excerpt: string; lastAction: string }[];
  research?: { id: string; question: string; summary: string; at: string }[];
  deployments?: { id: string; agentId: string; agentVersion: number; target: string; state: string; error: string }[];
  activity?: { id: string; action: string; target: string; result: string; at: string }[];
};
const COLLECTIONS = ["projects", "chats", "memories", "files", "agents", "runs"] as const;
const NAVIGATION_INDEX: readonly IndexedPaletteDocument[] = PALETTE_DESTINATIONS.map((item) => ({
  hit: { key: `nav-${item.id}`, label: item.label, meta: "Go to", view: item.id, ref: "" },
  searchText: [item.label, ...("aliases" in item ? item.aliases : [])].join(" ").toLowerCase(),
  labelText: item.label.toLowerCase(),
}));

/**
 * One latest snapshot per collection, with no unbounded query-result cache.
 * Callers use immutable collection/record updates. Unchanged message objects
 * reuse their normalized bodies even when another message in the chat changes.
 * The builder is component/owner scoped; it does not keep global workspace data.
 */
export function createPaletteIndexBuilder(): (input: PaletteData) => PaletteSearchIndex {
  let previous: PaletteData | null = null;
  let latest: PaletteSearchIndex | null = null;
  let projectNames = new Map<string, string>();
  const sections: Record<(typeof COLLECTIONS)[number], IndexedPaletteDocument[]> = { projects: [], chats: [], memories: [], files: [], agents: [], runs: [] };
  const messageText = new WeakMap<object, { text: string; normalized: string }>();
  const document = (hit: PaletteHit, text: string): IndexedPaletteDocument => ({ hit, searchText: text.toLowerCase(), labelText: hit.label.toLowerCase() });
  return (input) => {
    if (previous && latest && COLLECTIONS.every((key) => previous![key] === input[key])) return latest;
    const changed = (key: (typeof COLLECTIONS)[number]) => !previous || previous[key] !== input[key];
    const projectsChanged = changed("projects");
    if (projectsChanged) projectNames = new Map(input.projects.map((project) => [project.id, project.name]));
    const context = (id?: string | null) => id ? ` · ${projectNames.get(id) ?? "Removed project"}` : "";
    if (changed("agents")) sections.agents = input.agents.filter((agent) => !agent.archived).map((agent) => document(
      { key: `agent-${agent.id}`, label: agent.name, meta: "Agent", view: "agents", ref: agent.id }, `${agent.name} ${agent.description}`,
    ));
    if (changed("runs")) sections.runs = input.runs.map((run) => document(
      { key: `run-${run.id}`, label: run.goal.slice(0, 80), meta: `Run · ${run.state}`, view: "runs", ref: run.id }, `${run.goal} ${run.state}`,
    ));
    if (projectsChanged) sections.projects = input.projects.map((project) => document(
      { key: `project-${project.id}`, label: project.name, meta: "Project", view: "projects", ref: project.id }, `${project.name} ${project.description}`,
    ));
    if (changed("chats") || projectsChanged) sections.chats = input.chats.flatMap((chat) => {
      const projectContext = context(chat.projectId);
      const meta = `${chat.humanCode ? "Intelligence" : "Chat"}${chat.archived ? " · Archived" : ""}${chat.temporary ? " · Temporary" : ""}${projectContext}`;
      const base = { label: chat.title, meta, view: chat.humanCode ? "code" as const : "chat" as const, ref: chat.id, projectId: chat.projectId, archived: chat.archived, temporary: chat.temporary };
      const titleText = chat.title.toLowerCase();
      const header: IndexedPaletteDocument = { hit: { ...base, key: `chat-${chat.id}` }, searchText: `${chat.title}${projectContext}`.toLowerCase(), labelText: titleText, titleText };
      return [header, ...chat.messages.map((message, index): IndexedPaletteDocument => {
        let cached = messageText.get(message);
        if (!cached) {
          const text = message.content;
          cached = { text, normalized: text.toLowerCase() };
          messageText.set(message, cached);
        }
        return { hit: { ...base, key: `chat-${chat.id}-message-${message.id ?? index}`, messageId: message.id }, searchText: cached.normalized, labelText: titleText, excerptText: cached.text };
      })];
    });
    if (changed("memories")) sections.memories = input.memories.filter((note) => !note.archived).map((note) => document(
      { key: `note-${note.id}`, label: note.text.slice(0, 80), meta: "Note", view: "memory", ref: note.id }, note.text,
    ));
    if (changed("files") || projectsChanged) sections.files = input.files.map((file) => document(
      { key: `file-${file.id}`, label: file.name, meta: `File${context(file.projectId)}`, view: "files", ref: file.id, projectId: file.projectId }, `${file.name} ${file.text}${context(file.projectId)}`,
    ));
    previous = input;
    latest = {
      navigation: NAVIGATION_INDEX.map((item) => item.hit),
      documents: [...NAVIGATION_INDEX, ...sections.agents, ...sections.runs, ...sections.projects, ...sections.chats, ...sections.memories, ...sections.files],
    };
    return latest;
  };
}

export function queryPaletteIndex(index: PaletteSearchIndex, query: string): PaletteHit[] {
  const search = query.trim().toLowerCase();
  if (!search) return index.navigation.map((hit) => ({ ...hit }));
  const terms = searchTerms(search);
  const matches = (text: string) => terms.every((term) => text.includes(term));
  const matching = index.documents.filter((item) => matches(item.searchText));
  const matchingHeaders = new Map(matching.filter((item) => item.titleText !== undefined).map((item) => [item.hit.ref, item]));
  const firstMessages = new Map<string, IndexedPaletteDocument>();
  for (const item of matching) if (item.excerptText !== undefined && !firstMessages.has(item.hit.ref)) firstMessages.set(item.hit.ref, item);
  // A title match navigates to its first matching message instead of producing
  // an extra empty result. Every additional matching message stays independent.
  const matchesWithRanks = matching.filter((item) => item.titleText === undefined || !firstMessages.has(item.hit.ref)).map((item) => {
    const row = { ...item.hit };
    if (item.titleText !== undefined) row.rank = matches(item.titleText) ? 1 : 0;
    const header = matchingHeaders.get(row.ref);
    if (header && firstMessages.get(row.ref) === item) row.rank = matches(header.titleText!) ? 1 : 0;
    if (item.excerptText !== undefined) {
      const first = terms.map((term) => item.searchText.indexOf(term)).filter((at) => at >= 0);
      const start = Math.max(0, Math.min(...first) - 28);
      row.excerpt = item.excerptText.slice(start, start + Math.max(search.length, 140));
    }
    const rank = (item.labelText === search ? 100 : item.labelText.startsWith(search) ? 60 : terms.every((term) => item.labelText.includes(term)) ? 30 : 0) + (row.rank ?? 0) + (row.ref ? 4 : 0) - (row.archived ? 1 : 0);
    return { row, rank };
  });
  return matchesWithRanks.sort((a, b) => b.rank - a.rank || a.row.label.localeCompare(b.row.label) || a.row.key.localeCompare(b.row.key)).map((item) => item.row);
}

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

export function paletteShortcut(platform: string) {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}
