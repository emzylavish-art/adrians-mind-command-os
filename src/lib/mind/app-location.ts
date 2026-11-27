/** Stable share links for one chat, project, file, or bot.
 * Section history stays in `section`. This does not replace it.
 */

export const SHARE_ITEM_KEYS = ["chat", "project", "file", "bot"] as const;
export type ShareItemKey = (typeof SHARE_ITEM_KEYS)[number];

export type ShareWrite = {
  section: string;
  pane?: string | null;
  chat: string | null;
  project: string | null;
  file: string | null;
  bot: string | null;
};

export const SETTINGS_PANES = ["general", "connections", "voice", "pages", "data", "safety", "keys", "browser", "keyboard", "bits", "archived", "storage", "profile", "personalization"] as const;
export type SettingsPane = (typeof SETTINGS_PANES)[number];
export function settingsPaneFromSearch(search: string): SettingsPane | null {
  const params = paramsFrom(search);
  const pane = params.get("pane");
  return params.get("section") === "settings" && SETTINGS_PANES.includes(pane as SettingsPane) ? pane as SettingsPane : null;
}

export type ShareCatalog = {
  chats: readonly { id: string }[];
  projects: readonly { id: string }[];
  files: readonly { id: string }[];
  agents: readonly { id: string; archived?: boolean }[];
};

export type ResolvedShare = {
  view: string;
  chatId: string | null;
  projectId: string | null;
  fileId: string | null;
  botId: string | null;
  focusId: string | null;
  botArchived: boolean;
  missing: ShareItemKey[];
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function isShareId(value: string | null | undefined): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** Keep only the workspace selectors; embedded tools get no incidental URL parameters. */
export function embeddedWorkspaceSearch(search: string): string {
  const source = paramsFrom(search);
  const result = new URLSearchParams();
  for (const key of ["section", "pane", ...SHARE_ITEM_KEYS]) {
    const value = source.get(key);
    if (isShareId(value)) result.set(key, value);
  }
  return result.size ? `?${result}` : "";
}

function paramsFrom(search: string) {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

export function shareWriteForView(
  view: string,
  selected: { chat: string | null; project: string | null; file: string | null; bot: string | null },
): ShareWrite {
  return {
    section: view,
    chat: view === "chat" || view === "command" || view === "code" ? selected.chat : null,
    project: view === "projects" ? selected.project : null,
    file: view === "files" ? selected.file : null,
    bot: view === "agents" ? selected.bot : null,
  };
}

export function writeShareSearch(current: string, next: ShareWrite, knownSections: readonly string[]): string {
  const params = paramsFrom(current);
  for (const key of ["section", "pane", ...SHARE_ITEM_KEYS]) params.delete(key);
  if (next.section && next.section !== "command" && knownSections.includes(next.section)) {
    params.set("section", next.section);
  }
  if (next.section === "settings" && SETTINGS_PANES.includes(next.pane as SettingsPane)) params.set("pane", next.pane!);
  for (const key of SHARE_ITEM_KEYS) {
    const value = next[key];
    if (isShareId(value)) params.set(key, value);
  }
  const shareKeys = ["section", ...SHARE_ITEM_KEYS];
  const ordered = new URLSearchParams();
  for (const key of shareKeys) {
    const value = params.get(key);
    if (value) ordered.set(key, value);
  }
  for (const [key, value] of params.entries()) {
    if (!shareKeys.includes(key)) ordered.append(key, value);
  }
  const text = ordered.toString();
  return text ? `?${text}` : "";
}

export function canonicalShareSearch(search: string): string {
  const params = paramsFrom(search);
  const entries = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const ordered = new URLSearchParams();
  for (const [key, value] of entries) ordered.append(key, value);
  const text = ordered.toString();
  return text ? `?${text}` : "";
}

export function sameShareLocation(pathname: string, hash: string, left: string, right: string) {
  return pathname + canonicalShareSearch(left) + hash === pathname + canonicalShareSearch(right) + hash;
}

export function resolveShare(search: string, catalog: ShareCatalog, knownSections: readonly string[]): ResolvedShare {
  const params = paramsFrom(search);
  const requested = params.get("section");
  const section = requested && knownSections.includes(requested) ? requested : null;
  const chat = isShareId(params.get("chat")) ? params.get("chat") : null;
  const project = isShareId(params.get("project")) ? params.get("project") : null;
  const file = isShareId(params.get("file")) ? params.get("file") : null;
  const bot = isShareId(params.get("bot")) ? params.get("bot") : null;
  let view = section ?? "command";
  if (!section) {
    if (chat) view = "chat";
    else if (project) view = "projects";
    else if (file) view = "files";
    else if (bot) view = "agents";
  }
  const missing: ShareItemKey[] = [];
  const wantChat = view === "chat" || view === "command" || view === "code";
  const chatId = wantChat && chat && catalog.chats.some((item) => item.id === chat) ? chat : null;
  if (wantChat && chat && !chatId) missing.push("chat");
  const projectId = view === "projects" && project && catalog.projects.some((item) => item.id === project) ? project : null;
  if (view === "projects" && project && !projectId) missing.push("project");
  const fileId = view === "files" && file && catalog.files.some((item) => item.id === file) ? file : null;
  if (view === "files" && file && !fileId) missing.push("file");
  const agent = view === "agents" && bot ? catalog.agents.find((item) => item.id === bot) : undefined;
  const botId = agent ? bot : null;
  if (view === "agents" && bot && !botId) missing.push("bot");
  return {
    view,
    chatId,
    projectId,
    fileId,
    botId,
    focusId: projectId ? `project-${projectId}` : botId ? `bot-${botId}` : null,
    botArchived: Boolean(agent?.archived),
    missing,
  };
}

export function shareMissLabel(missing: readonly ShareItemKey[]) {
  if (missing.length === 0) return "";
  const names = missing.map((key) => (key === "bot" ? "bot" : key));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `This link points at a ${list} that is not on this device. Nothing was created.`;
}

export function shareWriteDropsMissing(
  current: string,
  next: ShareWrite,
  catalog: ShareCatalog,
  knownSections: readonly string[],
): boolean {
  const resolved = resolveShare(current, catalog, knownSections);
  if (resolved.missing.length === 0 || next.section !== resolved.view) return false;
  const params = paramsFrom(current);
  return resolved.missing.some((key) => isShareId(params.get(key)) && !isShareId(next[key]));
}

export type ShareHistory = {
  entries: string[];
  index: number;
};

export function startShareHistory(search = ""): ShareHistory {
  return { entries: [search], index: 0 };
}

export function currentShareSearch(history: ShareHistory) {
  return history.entries[history.index] ?? "";
}

export function pushShareHistory(history: ShareHistory, search: string): ShareHistory {
  if (canonicalShareSearch(currentShareSearch(history)) === canonicalShareSearch(search)) return history;
  const entries = history.entries.slice(0, history.index + 1);
  entries.push(search);
  return { entries, index: entries.length - 1 };
}

export function backShareHistory(history: ShareHistory): ShareHistory {
  if (history.index <= 0) return history;
  return { entries: history.entries, index: history.index - 1 };
}

export function forwardShareHistory(history: ShareHistory): ShareHistory {
  if (history.index >= history.entries.length - 1) return history;
  return { entries: history.entries, index: history.index + 1 };
}

export function navigateShare(
  history: ShareHistory,
  view: string,
  selected: { chat: string | null; project: string | null; file: string | null; bot: string | null },
  knownSections: readonly string[],
): ShareHistory {
  return pushShareHistory(history, writeShareSearch(currentShareSearch(history), shareWriteForView(view, selected), knownSections));
}
