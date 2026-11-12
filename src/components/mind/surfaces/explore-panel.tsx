import { useEffect, useMemo, useState } from "react";
import {
  PERSONA_CATEGORIES,
  buildPersonaDirectory,
  emptyStateForCategory,
  filterPersonaDirectory,
  isPersonaCategoryId,
  type PersonaCard,
  type PersonaCategoryId,
} from "@/lib/mind/personas";
import { emptyWorkspace, loadWorkspace } from "@/lib/mind/workspace";
import type { Workspace } from "@/lib/mind/types";

const SHELF_KEY = "adrian-explore-shelf";
const SOURCE_KEY = "adrian-explore-source";
const SORT_KEY = "adrian-explore-sort";
const PINS_KEY = "adrian-explore-pins";

const SOURCES = [
  { id: "both", label: "Templates and saved" },
  { id: "template", label: "Templates" },
  { id: "saved", label: "Saved agents" },
] as const;

const SORTS = [
  { id: "name", label: "Name" },
  { id: "role", label: "Role" },
] as const;

type ShelfId = PersonaCategoryId | "all";
type SourceId = (typeof SOURCES)[number]["id"];
type SortId = (typeof SORTS)[number]["id"];

const DEFAULT_NEXT =
  "Next: type a name in Search personas, press Official, then press Save and open Chat on that template. That writes a local agent and opens Chat. It does not start a remote bot, and the selected-agent handoff is not yet verified.";

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

function isShelf(value: string | null): value is ShelfId {
  return value === "all" || (value !== null && isPersonaCategoryId(value));
}

function isSource(value: string | null): value is SourceId {
  return value !== null && SOURCES.some((item) => item.id === value);
}

function isSort(value: string | null): value is SortId {
  return value !== null && SORTS.some((item) => item.id === value);
}

function shelfLabel(shelf: ShelfId): string {
  if (shelf === "all") return "All";
  return PERSONA_CATEGORIES.find((item) => item.id === shelf)?.label ?? shelf;
}

function sourceLabel(source: SourceId): string {
  return SOURCES.find((item) => item.id === source)?.label ?? source;
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

function openStep(card: PersonaCard): string {
  const shelf = card.source === "saved" ? "My agents" : "Official";
  return `Next: type “${card.name}” in Search personas, press ${shelf}, then press Save and open Chat on ${card.name}. That stores the local agent and opens Chat. It does not start a remote bot, and the selected-agent handoff is not yet verified.`;
}

function compareCards(sort: SortId) {
  return (left: PersonaCard, right: PersonaCard) => {
    const primary = sort === "role" ? left.role.localeCompare(right.role) : left.name.localeCompare(right.name);
    if (primary !== 0) return primary;
    return left.name.localeCompare(right.name);
  };
}

/**
 * Explore page controls. Preferences stay on this device.
 * The directory below this panel still owns Save and open Chat.
 */
export function ExplorePanel() {
  const [workspace, setWorkspace] = useState<Workspace>(() => emptyWorkspace());
  const [shelf, setShelf] = useState<ShelfId>("official");
  const [source, setSource] = useState<SourceId>("both");
  const [sort, setSort] = useState<SortId>("name");
  const [pins, setPins] = useState<string[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [next, setNext] = useState(DEFAULT_NEXT);
  const [savedNote, setSavedNote] = useState("Preferences load from this browser.");

  const directory = useMemo(
    () => buildPersonaDirectory({ agents: workspace.agents, deployments: workspace.deployments }),
    [workspace.agents, workspace.deployments],
  );

  useEffect(() => {
    let loaded = emptyWorkspace();
    try {
      loaded = loadWorkspace(window.localStorage);
    } catch {
      loaded = emptyWorkspace();
    }
    setWorkspace(loaded);
    const built = buildPersonaDirectory({ agents: loaded.agents, deployments: loaded.deployments });
    const known = new Set(built.cards.map((card) => card.id));
    const storedShelf = readKey(SHELF_KEY);
    const storedSource = readKey(SOURCE_KEY);
    const storedSort = readKey(SORT_KEY);
    if (isShelf(storedShelf)) setShelf(storedShelf);
    if (isSource(storedSource)) setSource(storedSource);
    if (isSort(storedSort)) setSort(storedSort);
    setPins(readPins(known));
    setSavedNote("Loaded the shelf, source, sort, and saved personas already stored in this browser.");
  }, []);

  const visible = useMemo(() => {
    const category = savedOnly ? "all" : shelf;
    return filterPersonaDirectory(directory, { category, query })
      .filter((card) => (source === "both" ? true : card.source === source))
      .filter((card) => (savedOnly ? pins.includes(card.id) : true))
      .slice()
      .sort(compareCards(sort));
  }, [directory, pins, query, savedOnly, shelf, sort, source]);

  function noteSaved(label: string, ok: boolean) {
    setSavedNote(ok ? `Saved ${label} on this device.` : `Could not save ${label}. This browser is blocking storage.`);
  }

  function chooseShelf(nextShelf: ShelfId) {
    setShelf(nextShelf);
    setSavedOnly(false);
    const label = shelfLabel(nextShelf);
    noteSaved(`${label} as the Explore shelf`, writeKey(SHELF_KEY, nextShelf));
    const empty = emptyStateForCategory(nextShelf, filterPersonaDirectory(directory, { category: nextShelf }).length);
    setNext(
      empty
        ? `Next: press Official. ${empty}`
        : `Next: press ${label} in Persona categories, then press Save and open Chat on the persona you want.`,
    );
  }

  function chooseSource(nextSource: SourceId) {
    setSource(nextSource);
    const label = sourceLabel(nextSource);
    noteSaved(`${label} as the Explore source`, writeKey(SOURCE_KEY, nextSource));
    setNext(
      nextSource === "saved"
        ? "Next: press My agents in Persona categories. Saved agents are the only rows this source keeps."
        : nextSource === "template"
          ? "Next: press Official in Persona categories. Templates stay labeled Not live until Save and open Chat stores one."
          : "Next: press All in Persona categories to see templates and saved agents together.",
    );
  }

  function chooseSort(nextSort: SortId) {
    setSort(nextSort);
    const label = SORTS.find((item) => item.id === nextSort)?.label ?? nextSort;
    noteSaved(`${label} sort`, writeKey(SORT_KEY, nextSort));
  }

  function togglePin(card: PersonaCard) {
    const nextPins = pins.includes(card.id) ? pins.filter((id) => id !== card.id) : [...pins, card.id];
    setPins(nextPins);
    noteSaved(`“${card.name}”`, writeKey(PINS_KEY, JSON.stringify(nextPins)));
  }

  function reloadLocal() {
    try {
      const loaded = loadWorkspace(window.localStorage);
      setWorkspace(loaded);
      const savedCount = loaded.agents.filter((agent) => !agent.archived).length;
      setSavedNote("Reloaded the local workspace from this browser.");
      setNext(
        savedCount === 0
          ? "Next: no saved agents were found. Press Official, then press Save and open Chat on a template."
          : `Next: ${savedCount} saved agent${savedCount === 1 ? "" : "s"} loaded. Press My agents, then press Save and open Chat on the one you want.`,
      );
    } catch {
      setWorkspace(emptyWorkspace());
      setNext("Next: this browser blocked workspace storage. Press Back to Chat, allow site data, reload, then open Explore again.");
    }
  }

  const emptyCopy = savedOnly
    ? "No saved personas yet. Next: press Save on a row you want back, or press All to leave the saved filter."
    : visible.length === 0
      ? `${emptyStateForCategory(shelf, 0) ?? "No local personas match."} Next: press Official, or clear the filter text.`
      : null;

  return (
    <section className="explore-panel" aria-labelledby="explore-panel-title" data-testid="explore-panel">
      <style>{PANEL_CSS}</style>
      <header className="explore-panel__head">
        <h1 id="explore-panel-title">Explore</h1>
        <p>Keep a local shelf, filter the personas already on this device, and follow the exact next step before Chat.</p>
      </header>

      <p className="explore-panel__next" role="status">
        {next}
      </p>
      <p className="explore-panel__note">{savedNote}</p>

      <div className="explore-panel__actions">
        <button type="button" onClick={() => setNext(DEFAULT_NEXT)}>
          Show how to open a template
        </button>
        <button type="button" onClick={() => setNext("Next: press Back to Chat. That leaves Explore without selecting a persona.")}>
          Show how to leave Explore
        </button>
        <button type="button" onClick={reloadLocal}>
          Reload this browser, then show the next step
        </button>
        <button
          type="button"
          onClick={() =>
            setNext(
              "Next: Video, Audio, and Budget have no local personas. Press Official or My agents. Explore does not list remote bots and does not sell points.",
            )
          }
        >
          Show shelves with no local personas
        </button>
      </div>

      <fieldset className="explore-panel__group">
        <legend>Shelf saved on this device</legend>
        <div className="explore-panel__row" role="group" aria-label="Saved Explore shelf">
          <button type="button" aria-pressed={shelf === "all" && !savedOnly} onClick={() => chooseShelf("all")}>
            All
          </button>
          {PERSONA_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={shelf === item.id && !savedOnly}
              onClick={() => chooseShelf(item.id)}
            >
              {item.label}
              <span> {directory.counts[item.id]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="explore-panel__group">
        <legend>Source saved on this device</legend>
        <div className="explore-panel__row" role="group" aria-label="Persona source">
          {SOURCES.map((item) => (
            <button key={item.id} type="button" aria-pressed={source === item.id} onClick={() => chooseSource(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="explore-panel__group">
        <legend>Sort saved on this device</legend>
        <div className="explore-panel__row" role="group" aria-label="Persona sort">
          {SORTS.map((item) => (
            <button key={item.id} type="button" aria-pressed={sort === item.id} onClick={() => chooseSort(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="explore-panel__list">
        <div className="explore-panel__list-head">
          <h2>Local personas</h2>
          <label>
            Filter text
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by a name or role"
              aria-label="Filter local personas"
            />
          </label>
        </div>
        <div className="explore-panel__row" role="group" aria-label="Filter saved personas">
          <button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>
            All
          </button>
          <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(true)}>
            {`Saved (${pins.length})`}
          </button>
        </div>
        <p className="explore-panel__count">
          {visible.length === 1 ? "1 persona" : `${visible.length} personas`}
          {savedOnly ? " in Saved" : shelf === "all" ? "" : ` in ${shelfLabel(shelf)}`}
          {source === "both" ? "" : ` from ${sourceLabel(source)}`}
          {query.trim() ? ` matching “${query.trim()}”` : ""}.
        </p>
        {emptyCopy ? (
          <p className="explore-panel__empty">{emptyCopy}</p>
        ) : (
          <ul>
            {visible.map((card) => {
              const saved = pins.includes(card.id);
              return (
                <li key={card.id}>
                  <p>
                    <span>{`${card.badge} · ${card.role} · Not live`}</span>
                    {card.name}
                    {". "}
                    {card.description}
                    {" "}
                    {card.statusLabel}.
                  </p>
                  <div className="explore-panel__row">
                    <button type="button" onClick={() => setNext(openStep(card))}>
                      Use this persona next
                    </button>
                    <button type="button" aria-pressed={saved} onClick={() => togglePin(card)}>
                      {saved ? "Saved" : "Save"}
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

export default ExplorePanel;

const PANEL_CSS = `
.explore-panel {
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
.explore-panel *, .explore-panel *::before, .explore-panel *::after { box-sizing: border-box; }
.explore-panel__head h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.explore-panel__head p,
.explore-panel__note,
.explore-panel__count,
.explore-panel__empty {
  margin: 0.35rem 0 0;
  color: var(--color-muted, #9aa3b5);
  overflow-wrap: anywhere;
}
.explore-panel__next {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 0.85rem;
  background: var(--color-surface-2, #141a24);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.explore-panel__actions,
.explore-panel__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}
.explore-panel button,
.explore-panel input {
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
.explore-panel button {
  padding: 0.45rem 0.85rem;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.explore-panel button[aria-pressed="true"] {
  background: var(--color-accent, #e8ecf5);
  color: var(--color-accent-ink, #0a0d14);
  border-color: transparent;
}
.explore-panel__group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.explore-panel__group legend,
.explore-panel__list h2 {
  padding: 0;
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
}
.explore-panel__list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.explore-panel__list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 0.65rem;
}
.explore-panel__list-head label {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.85rem;
}
.explore-panel input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 0.45rem 0.75rem;
  background: var(--color-surface, #0c1018);
}
.explore-panel ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.explore-panel li {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-line, #243044);
}
.explore-panel li p {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.explore-panel li span {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
@media (min-width: 64rem) {
  .explore-panel { padding: 1.25rem 0.25rem 1.25rem 0; }
}
`;
