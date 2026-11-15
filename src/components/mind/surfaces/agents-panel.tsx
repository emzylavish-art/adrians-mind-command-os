import { useEffect, useMemo, useState } from "react";
import { AGENT_TEMPLATES, toolCatalog, type AgentDefinition, type FleetTool } from "@/lib/mind/fleet";
import { emptyWorkspace, loadWorkspace } from "@/lib/mind/workspace";

const SOURCE_KEY = "adrian-agents-source";
const SORT_KEY = "adrian-agents-sort";
const FILTER_KEY = "adrian-agents-filter";
const PINS_KEY = "adrian-agents-pins";
const REMINDER_KEY = "adrian-agents-hosted-reminder";

const SOURCES = [
  { id: "both", label: "Templates and saved" },
  { id: "template", label: "Templates" },
  { id: "saved", label: "Saved agents" },
] as const;

const SORTS = [
  { id: "name", label: "Name" },
  { id: "role", label: "Role" },
] as const;

const FILTERS = ["All", "Local", "Asks first", "External", "Pinned"] as const;

type SourceId = (typeof SOURCES)[number]["id"];
type SortId = (typeof SORTS)[number]["id"];
type FilterId = (typeof FILTERS)[number];
type RowSource = "template" | "saved";

type AgentRow = {
  id: string;
  name: string;
  role: string;
  description: string;
  source: RowSource;
  approval: "ask" | "automatic";
  tools: FleetTool[];
};

const CATALOG = toolCatalog();
const CATALOG_BY_ID = new Map(CATALOG.map((item) => [item.id, item]));

const DEFAULT_NEXT =
  "Next: in Agent directory, press Add Personal assistant. That stores the template on this device. It does not start a process. Press Refresh status before treating any hosted bot as listed.";

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function isSource(value: string | null): value is SourceId {
  return value !== null && SOURCES.some((item) => item.id === value);
}

function isSort(value: string | null): value is SortId {
  return value !== null && SORTS.some((item) => item.id === value);
}

function isFilter(value: string | null): value is FilterId {
  return value !== null && (FILTERS as readonly string[]).includes(value);
}

function sourceLabel(source: SourceId): string {
  return SOURCES.find((item) => item.id === source)?.label ?? source;
}

function rowSourceLabel(source: RowSource): string {
  return source === "saved" ? "Saved agent" : "Template";
}

function isExternal(tools: FleetTool[]): boolean {
  return tools.some((tool) => CATALOG_BY_ID.get(tool)?.available === false);
}

function toolSummary(tools: FleetTool[]): string {
  if (tools.length === 0) return "Tools: none.";
  const labels = tools.map((tool) => {
    const item = CATALOG_BY_ID.get(tool);
    if (!item) return tool;
    return item.available ? item.name : `${item.name} (not configured)`;
  });
  return `Tools: ${labels.join(", ")}.`;
}

function readPins(known: Set<string>): string[] {
  const raw = readKey(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && known.has(id));
  } catch {
    return [];
  }
}

function templateRows(): AgentRow[] {
  return AGENT_TEMPLATES.map((item) => ({
    id: `template:${item.name}`,
    name: item.name,
    role: item.role,
    description: item.description,
    source: "template",
    approval: item.approval,
    tools: [...item.tools],
  }));
}

function savedRows(agents: AgentDefinition[]): AgentRow[] {
  return agents
    .filter((agent) => !agent.archived && agent.name.trim())
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role || "agent",
      description: agent.description || "Stored on this device. This list does not mean it is running.",
      source: "saved",
      approval: agent.approval === "automatic" ? "automatic" : "ask",
      tools: agent.tools,
    }));
}

function compareRows(sort: SortId) {
  return (left: AgentRow, right: AgentRow) => {
    const primary = sort === "role" ? left.role.localeCompare(right.role) : left.name.localeCompare(right.name);
    if (primary !== 0) return primary;
    return left.name.localeCompare(right.name);
  };
}

function matchesFilter(row: AgentRow, filter: FilterId, pins: string[]): boolean {
  if (filter === "Pinned") return pins.includes(row.id);
  if (filter === "Local") return row.approval === "automatic" && !isExternal(row.tools);
  if (filter === "Asks first") return row.approval === "ask";
  if (filter === "External") return isExternal(row.tools);
  return true;
}

function directoryStep(row: AgentRow, reminder: boolean): string {
  const tools = toolSummary(row.tools);
  const hosted = reminder
    ? " The hosted reminder is on for this device only, so do not press Record hosted target unless you mean to record that target."
    : "";
  if (row.source === "template") {
    return `Next: in Agent directory, press Add ${row.name}. That stores “${row.name}” on this device. It does not start a process. ${tools}${hosted}`;
  }
  return `Next: find “${row.name}” in Agent directory, then press Arm local worker. That records a local-worker target on this device. It does not start a hosted process. ${tools}${hosted}`;
}

/**
 * Agents page controls. Preferences stay on this device.
 * Agent directory still owns Add, Save agent, Arm local worker, and Refresh status.
 */
export function AgentsPanel() {
  const [rows, setRows] = useState<AgentRow[]>(() => templateRows());
  const [source, setSource] = useState<SourceId>("both");
  const [sort, setSort] = useState<SortId>("name");
  const [filter, setFilter] = useState<FilterId>("All");
  const [pins, setPins] = useState<string[]>([]);
  const [hostedReminder, setHostedReminder] = useState(true);
  const [query, setQuery] = useState("");
  const [next, setNext] = useState(DEFAULT_NEXT);
  const [savedNote, setSavedNote] = useState("Preferences load from this browser.");

  useEffect(() => {
    let agents: AgentDefinition[] = [];
    try {
      agents = loadWorkspace(window.localStorage).agents;
    } catch {
      agents = emptyWorkspace().agents;
    }
    const built = [...templateRows(), ...savedRows(agents)];
    setRows(built);
    const storedSource = readKey(SOURCE_KEY);
    const storedSort = readKey(SORT_KEY);
    const storedFilter = readKey(FILTER_KEY);
    const storedReminder = readKey(REMINDER_KEY);
    if (isSource(storedSource)) setSource(storedSource);
    if (isSort(storedSort)) setSort(storedSort);
    if (isFilter(storedFilter)) setFilter(storedFilter);
    if (storedReminder === "on" || storedReminder === "off") setHostedReminder(storedReminder === "on");
    setPins(readPins(new Set(built.map((row) => row.id))));
    setSavedNote("Loaded the source, sort, filter, pins, and hosted reminder already stored in this browser.");
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => (source === "both" ? true : row.source === source))
      .filter((row) => matchesFilter(row, filter, pins))
      .filter((row) => {
        if (!needle) return true;
        return `${row.name} ${row.role} ${row.description} ${row.tools.join(" ")}`.toLowerCase().includes(needle);
      })
      .slice()
      .sort(compareRows(sort));
  }, [filter, pins, query, rows, sort, source]);

  function noteSaved(label: string, ok: boolean) {
    setSavedNote(ok ? `Saved ${label} on this device.` : `Could not save ${label}. This browser is blocking storage.`);
  }

  function chooseSource(nextSource: SourceId) {
    setSource(nextSource);
    const label = sourceLabel(nextSource);
    noteSaved(`${label} as the agent source`, writeKey(SOURCE_KEY, nextSource));
    setNext(
      nextSource === "saved"
        ? "Next: if a saved agent is listed below, find that same name in Agent directory and press Arm local worker. If none are listed, press Add Personal assistant."
        : nextSource === "template"
          ? "Next: press Add beside the template name in Agent directory. Adding a template stores it on this device. It does not start a process."
          : "Next: use a row below, then press the matching Add or Arm local worker control in Agent directory.",
    );
  }

  function chooseSort(nextSort: SortId) {
    setSort(nextSort);
    const label = SORTS.find((item) => item.id === nextSort)?.label ?? nextSort;
    noteSaved(`${label} sort`, writeKey(SORT_KEY, nextSort));
  }

  function chooseFilter(nextFilter: FilterId) {
    setFilter(nextFilter);
    noteSaved(`${nextFilter} as the agent filter`, writeKey(FILTER_KEY, nextFilter));
  }

  function togglePin(row: AgentRow) {
    const nextPins = pins.includes(row.id) ? pins.filter((id) => id !== row.id) : [...pins, row.id];
    setPins(nextPins);
    noteSaved(`“${row.name}”`, writeKey(PINS_KEY, JSON.stringify(nextPins)));
  }

  function toggleReminder() {
    const nextOn = !hostedReminder;
    setHostedReminder(nextOn);
    noteSaved(nextOn ? "hosted reminder on" : "hosted reminder off", writeKey(REMINDER_KEY, nextOn ? "on" : "off"));
    setNext(
      nextOn
        ? "Next: leave Record hosted target unpressed unless you mean to record that target. Press Refresh status under Paperclip agent service before treating a bot as listed."
        : "Next: this reminder is off on this device only. Record hosted target still does nothing until you press it, and Refresh status is still the check for a real service.",
    );
  }

  function reloadLocal() {
    try {
      const loaded = loadWorkspace(window.localStorage);
      const built = [...templateRows(), ...savedRows(loaded.agents)];
      setRows(built);
      setPins((current) => current.filter((id) => built.some((row) => row.id === id)));
      const savedCount = built.filter((row) => row.source === "saved").length;
      setSavedNote("Reloaded the local workspace from this browser.");
      setNext(
        savedCount === 0
          ? "Next: no saved agents were found. In Agent directory, press Add Personal assistant."
          : `Next: ${savedCount} saved agent${savedCount === 1 ? "" : "s"} loaded. Find the one you want in Agent directory, then press Arm local worker.`,
      );
    } catch {
      setRows(templateRows());
      setNext("Next: this browser blocked workspace storage. Allow site data, reload, then open Agents again.");
    }
  }

  const emptyCopy =
    filter === "Pinned" && pins.length === 0
      ? "No pinned agents yet. Next: press Pin on a row you want back, or press All."
      : source === "saved" && rows.every((row) => row.source !== "saved")
        ? "No saved agents in this browser. Next: in Agent directory, press Add Personal assistant."
        : "No agents match this filter. Next: clear the text, or press All.";

  return (
    <section className="agents-panel" aria-labelledby="agents-panel-title" data-testid="agents-panel">
      <style>{PANEL_CSS}</style>
      <header className="agents-panel__head">
        <h1 id="agents-panel-title">Agents</h1>
        <p>Filter the templates and saved agents on this device, then follow the exact control to press on this page.</p>
      </header>

      <p className="agents-panel__next" role="status">
        {next}
      </p>
      <p className="agents-panel__note">{savedNote}</p>

      <div className="agents-panel__actions">
        <button type="button" onClick={() => setNext(DEFAULT_NEXT)}>
          Show how to add a template
        </button>
        <button
          type="button"
          onClick={() =>
            setNext(
              "Next: in Custom agent, type a name in Agent name, write Instructions, press only the tools you want, then press Save agent. A tool that is not configured waits. It does not report success.",
            )
          }
        >
          Show how to save a custom agent
        </button>
        <button
          type="button"
          onClick={() =>
            setNext(
              "Next: open Look up on this device, type a word in Word to find in notes, then press Run lookup. You approve the three local steps before they run. Stop blocks them. That lookup does not call a model.",
            )
          }
        >
          Show how to look up notes
        </button>
        <button
          type="button"
          onClick={() =>
            setNext(
              "Next: open Look up on this device, type the question in What should the planner look up?, then press Run planner. That spends a model request and can call only projects, chats, and notes. Press Stop this run to discard an unfinished reply.",
            )
          }
        >
          Show how to run the planner
        </button>
        <button
          type="button"
          onClick={() =>
            setNext(
              "Next: press Run REA doctor in the Agents section. A report appears only after that check. Inspect staged file stays off until a file is staged.",
            )
          }
        >
          Show how to run the file check
        </button>
        <button
          type="button"
          onClick={() =>
            setNext(
              "Next: press Refresh status under Paperclip agent service. A hosted bot is listed only when that service answers. If it says no instance is authorised, or that status could not be loaded, no agents were marked as running.",
            )
          }
        >
          Show how to check the hosted service
        </button>
        <button type="button" onClick={reloadLocal}>
          Reload this browser, then show the next step
        </button>
        <button type="button" aria-pressed={hostedReminder} onClick={toggleReminder}>
          {hostedReminder ? "Hosted reminder is on" : "Hosted reminder is off"}
        </button>
      </div>

      <fieldset className="agents-panel__group">
        <legend>Source saved on this device</legend>
        <div className="agents-panel__row" role="group" aria-label="Agent source">
          {SOURCES.map((item) => (
            <button key={item.id} type="button" aria-pressed={source === item.id} onClick={() => chooseSource(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="agents-panel__group">
        <legend>Sort saved on this device</legend>
        <div className="agents-panel__row" role="group" aria-label="Agent sort">
          {SORTS.map((item) => (
            <button key={item.id} type="button" aria-pressed={sort === item.id} onClick={() => chooseSort(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="agents-panel__list">
        <div className="agents-panel__list-head">
          <h2>On this device</h2>
          <label>
            Filter text
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by a name, role, or tool"
              aria-label="Filter agents"
            />
          </label>
        </div>
        <div className="agents-panel__row" role="group" aria-label="Filter agents">
          {FILTERS.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => chooseFilter(item)}>
              {item === "Pinned" ? `Pinned (${pins.length})` : item}
            </button>
          ))}
        </div>
        <p className="agents-panel__count">
          {visible.length === 1 ? "1 agent" : `${visible.length} agents`}
          {filter === "All" ? "" : ` in ${filter}`}
          {source === "both" ? "" : ` from ${sourceLabel(source)}`}
          {query.trim() ? ` matching “${query.trim()}”` : ""}.
        </p>
        {visible.length === 0 ? (
          <p className="agents-panel__empty">{emptyCopy}</p>
        ) : (
          <ul>
            {visible.map((row) => {
              const pinned = pins.includes(row.id);
              return (
                <li key={row.id}>
                  <p>
                    <span>{`${rowSourceLabel(row.source)} · ${row.role} · Not a running process`}</span>
                    {row.name}
                    {". "}
                    {row.description} {toolSummary(row.tools)}
                  </p>
                  <div className="agents-panel__row">
                    <button type="button" onClick={() => setNext(directoryStep(row, hostedReminder))}>
                      Use this agent next
                    </button>
                    <button type="button" aria-pressed={pinned} onClick={() => togglePin(row)}>
                      {pinned ? "Pinned" : "Pin"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default AgentsPanel;

const PANEL_CSS = `
.agents-panel {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 1rem;
  color: var(--color-fg, #f4f6fb);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.agents-panel *, .agents-panel *::before, .agents-panel *::after { box-sizing: border-box; }
.agents-panel__head h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.agents-panel__head p,
.agents-panel__note,
.agents-panel__count,
.agents-panel__empty {
  margin: 0.35rem 0 0;
  color: var(--color-muted, #9aa3b5);
  overflow-wrap: anywhere;
}
.agents-panel__next {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 0.85rem;
  background: var(--color-surface-2, #141a24);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.agents-panel__actions,
.agents-panel__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}
.agents-panel button,
.agents-panel input {
  max-width: 100%;
  min-width: 0;
  min-height: 2.75rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.3;
}
.agents-panel button {
  padding: 0.45rem 0.85rem;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.agents-panel button[aria-pressed="true"] {
  background: var(--color-accent, #e8ecf5);
  color: var(--color-accent-ink, #0a0d14);
  border-color: transparent;
}
.agents-panel__group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.agents-panel__group legend,
.agents-panel__list h2 {
  padding: 0;
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
}
.agents-panel__list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.agents-panel__list-head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.65rem;
}
.agents-panel__list-head label {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.85rem;
}
.agents-panel input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 0.45rem 0.75rem;
  background: var(--color-surface, #0c1018);
}
.agents-panel ul {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.agents-panel li {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-line, #243044);
}
.agents-panel li p {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.agents-panel li span {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
@media (min-width: 64rem) {
  .agents-panel { padding: 1.25rem 0.25rem 1.25rem 0; }
}
`;
