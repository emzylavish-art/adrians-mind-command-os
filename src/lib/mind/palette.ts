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

function searchable(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function searchTerms(query: string): string[] {
  return [...searchable(query).matchAll(/"([^"\n]+)"|([^\s"]+)/g)].map(match => (match[1] ?? match[2] ?? "").trim()).filter(Boolean);
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
  focusId?: string;
  rankTime?: string;
  matchCount?: number;
};

export type PaletteData = {
  projects: { id: string; name: string; description: string }[];
  chats: { id: string; title: string; messages: { id?: string; content: string; at?: string }[]; humanCode?: boolean; projectId?: string | null; archived?: boolean; temporary?: boolean; updatedAt?: string }[];
  memories: { id: string; text: string; archived: boolean }[];
  files: { id: string; name: string; text: string; projectId?: string | null }[];
  agents: { id: string; name: string; description: string; archived: boolean; version?: number }[];
  runs: { id: string; goal: string; state: string }[];
  schedules?: { id: string; goal?: string; task?: string; prompt?: string; name?: string; enabled?: boolean; instruction?: string; timeZone?: string }[];
  research?: { id: string; question: string; summary: string; at?: string }[];
  activity?: { id: string; action: string; target: string; result: string; at?: string }[];
  connections?: { id: string; name?: string; label?: string; status?: string; state?: string; provider?: string }[];
  skills?: { id: string; name: string; description?: string }[];
  browserSessions?: { id: string; title: string; url: string; excerpt: string; lastAction: string }[];
  deployments?: { id: string; agentId: string; agentVersion: number; target: string; state: string; error: string }[];
};

export type PaletteInput = PaletteData & {
  query: string;
  filter?: PaletteHit["view"] | "all";
};
const COLLECTIONS = ["projects", "chats", "memories", "files", "agents", "runs", "schedules", "research", "activity", "connections", "skills", "browserSessions", "deployments"] as const;
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
  const sections: Partial<Record<(typeof COLLECTIONS)[number], IndexedPaletteDocument[]>> = {};
  const messageText = new WeakMap<object, { text: string; normalized: string }>();
  const document = (hit: PaletteHit, text: string): IndexedPaletteDocument => ({ hit, searchText: searchable(text), labelText: searchable(hit.label), excerptText: text });
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
      const titleText = searchable(chat.title);
      const header: IndexedPaletteDocument = { hit: { ...base, key: `chat-${chat.id}` }, searchText: searchable(chat.title + projectContext), labelText: titleText, titleText };
      return [header, ...chat.messages.map((message, index): IndexedPaletteDocument => {
        let cached = messageText.get(message);
        if (!cached) {
          const text = message.content;
          cached = { text, normalized: searchable(text) };
          messageText.set(message, cached);
        }
        return { hit: { ...base, key: `chat-${chat.id}-message-${message.id ?? index}`, messageId: message.id, rankTime: message.at }, searchText: cached.normalized, labelText: titleText, excerptText: cached.text };
      })];
    });
    if (changed("memories")) sections.memories = input.memories.filter((note) => !note.archived).map((note) => document(
      { key: `note-${note.id}`, label: note.text.slice(0, 80), meta: "Note", view: "memory", ref: note.id }, note.text,
    ));
    if (changed("files") || projectsChanged) sections.files = input.files.map((file) => document(
      { key: `file-${file.id}`, label: file.name, meta: `File${context(file.projectId)}`, view: "files", ref: file.id, projectId: file.projectId }, `${file.name} ${file.text}${context(file.projectId)}`,
    ));
    if (changed("schedules")) sections.schedules = (input.schedules ?? []).map(job => document(
      { key: "schedule:" + job.id, label: job.name || job.goal || job.task || job.prompt || "Scheduled task", meta: job.enabled ? "Schedule · enabled" : "Schedule · paused", view: "scheduled", ref: job.id, focusId: "schedule-" + job.id },
      [job.name, job.goal, job.task, job.prompt, job.instruction, job.timeZone].filter(Boolean).join(" "),
    ));
    if (changed("research")) sections.research = (input.research ?? []).map(report => document(
      { key: "research:" + report.id, label: report.question, meta: "Research report", view: "research", ref: report.id, focusId: "research-" + report.id, rankTime: report.at }, report.question + " " + report.summary,
    ));
    if (changed("activity")) sections.activity = (input.activity ?? []).map(entry => document(
      { key: "activity:" + entry.id, label: entry.action.replaceAll("_", " "), meta: "Activity", view: "activity", ref: entry.id, focusId: "audit-" + entry.id, rankTime: entry.at }, [entry.action.replaceAll("_", " "), entry.target, entry.result].join(" "),
    ));
    if (changed("connections")) sections.connections = (input.connections ?? []).map(item => document(
      { key: "connection:" + item.id, label: item.label || item.name || item.id, meta: "Connection", view: "connected", ref: item.id, focusId: "connection-" + item.id }, [item.label, item.name, item.provider, item.status, item.state].filter(Boolean).join(" "),
    ));
    if (changed("skills")) sections.skills = (input.skills ?? []).map(skill => document(
      { key: "skill:" + skill.id, label: skill.name, meta: "Skill", view: "skills", ref: skill.id }, skill.name + " " + (skill.description ?? ""),
    ));
    if (changed("browserSessions")) sections.browserSessions = (input.browserSessions ?? []).map(session => document(
      { key: "browser:" + session.id, label: session.title || session.url, meta: "Browser record", view: "tools", ref: session.id, focusId: "browser-" + session.id }, [session.title, session.url, session.excerpt, session.lastAction].join(" "),
    ));
    if (changed("deployments") || changed("agents")) {
      const newest = new Set<string>();
      sections.deployments = (input.deployments ?? []).flatMap(item => {
        const agent = input.agents.find(candidate => candidate.id === item.agentId && candidate.version === item.agentVersion && !candidate.archived);
        if (!agent || newest.has(agent.id)) return [];
        newest.add(agent.id);
        return [document({ key: "deployment:" + item.id, label: agent.name + " · " + item.target, meta: "Deployment record", view: "agents", ref: agent.id, focusId: "deployment-" + item.id }, [agent.name, item.target, item.state, item.error].join(" "))];
      });
    }
    previous = input;
    latest = {
      navigation: NAVIGATION_INDEX.map((item) => item.hit),
      documents: [...NAVIGATION_INDEX, ...COLLECTIONS.flatMap(key => sections[key] ?? [])],
    };
    return latest;
  };
}

export function queryPaletteIndex(index: PaletteSearchIndex, query: string): PaletteHit[] {
  const search = searchable(query);
  if (!search) return index.navigation.map((hit) => ({ ...hit }));
  const terms = searchTerms(search);
  const matches = (text: string) => terms.every((term) => text.includes(term));
  const matching = index.documents.filter((item) => matches(item.searchText));
  const matchingHeaders = new Map(matching.filter((item) => item.titleText !== undefined).map((item) => [item.hit.ref, item]));
  const firstMessages = new Map<string, IndexedPaletteDocument>();
  for (const item of matching) if (item.excerptText !== undefined && (item.hit.view === "chat" || item.hit.view === "code") && !firstMessages.has(item.hit.ref)) firstMessages.set(item.hit.ref, item);
  // A title match navigates to its first matching message instead of producing
  // an extra empty result. Every additional matching message stays independent.
  const matchesWithRanks = matching.filter((item) => item.titleText === undefined || !firstMessages.has(item.hit.ref)).map((item) => {
    const row = { ...item.hit };
    if (item.titleText !== undefined) row.rank = matches(item.titleText) ? 1 : 0;
    const header = matchingHeaders.get(row.ref);
    if (header && (row.view === "chat" || row.view === "code")) row.rank = matches(header.titleText!) ? 1 : 0;
    if (item.excerptText !== undefined) {
      const first = terms.map((term) => item.searchText.indexOf(term)).filter((at) => at >= 0);
      const start = Math.max(0, Math.min(...first) - 28);
      row.excerpt = item.excerptText.slice(start, start + Math.max(search.length, 140));
    }
    const rank = (item.labelText === search ? 100 : item.labelText.startsWith(search) ? 60 : terms.every((term) => item.labelText.includes(term)) ? 30 : 0) + (row.rank ?? 0) + (row.ref ? 4 : 0) - (row.archived ? 1 : 0);
    return { row, rank };
  });
  return matchesWithRanks.sort((a, b) => b.rank - a.rank || (b.row.rankTime ?? "").localeCompare(a.row.rankTime ?? "") || a.row.label.localeCompare(b.row.label) || a.row.key.localeCompare(b.row.key)).map((item) => item.row);
}

export function paletteHits(input: PaletteInput): PaletteHit[] {
  const rows = queryPaletteIndex(createPaletteIndexBuilder()(input), input.query);
  return input.filter && input.filter !== "all" ? rows.filter(hit => hit.view === input.filter) : rows;
}

export function paletteShortcut(platform: string) {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}
