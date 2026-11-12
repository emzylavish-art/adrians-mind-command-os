import { useEffect, useMemo, useState } from "react";
import { shouldRunDeepResearch } from "@/lib/mind/research";
import { emptyWorkspace, loadWorkspace } from "@/lib/mind/workspace";

const DEPTH_KEY = "adrian-research-depth";
const FOCUS_KEY = "adrian-research-focus";
const SORT_KEY = "adrian-research-sort";
const FILTER_KEY = "adrian-research-filter";
const PINS_KEY = "adrian-research-pins";
const QUESTIONS_KEY = "adrian-research-questions";

const SENT_LIMIT = 300;
const QUESTION_LIMIT = 40;

const DEPTHS = [
  { id: "single", label: "Single check" },
  { id: "deep", label: "Deep check" },
] as const;

const FOCUSES = [
  { id: "plain", label: "Plain" },
  { id: "overview", label: "Overview" },
  { id: "risks", label: "Risks" },
  { id: "comparison", label: "Comparison" },
] as const;

const SORTS = [
  { id: "recent", label: "Recent" },
  { id: "name", label: "Name" },
] as const;

const FILTERS = ["all", "pinned", "mine", "plain", "overview", "risks", "comparison"] as const;

type DepthId = (typeof DEPTHS)[number]["id"];
type FocusId = (typeof FOCUSES)[number]["id"];
type SortId = (typeof SORTS)[number]["id"];
type FilterId = (typeof FILTERS)[number];

type LocalQuestion = {
  id: string;
  text: string;
  focus: FocusId;
  createdAt: number;
  mine: boolean;
};

const STARTERS: LocalQuestion[] = [
  { id: "starter-zoning", text: "Toledo Bend marina zoning", focus: "overview", createdAt: 0, mine: false },
  { id: "starter-waterfront", text: "Toledo Bend waterfront", focus: "risks", createdAt: 0, mine: false },
  { id: "starter-pier", text: "Pier construction rules", focus: "comparison", createdAt: 0, mine: false },
  { id: "starter-harbor", text: "Public harbor rules for a new pier", focus: "plain", createdAt: 0, mine: false },
];

const DEFAULT_NEXT =
  "Next: type a question in What do you want to research?, then press Check research. A blank question is not searched. If the saved Grok key cannot search, Check research refuses and creates no citations.";

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

function isDepth(value: string | null): value is DepthId {
  return value !== null && DEPTHS.some((item) => item.id === value);
}

function isFocus(value: string | null): value is FocusId {
  return value !== null && FOCUSES.some((item) => item.id === value);
}

function isSort(value: string | null): value is SortId {
  return value !== null && SORTS.some((item) => item.id === value);
}

function isFilter(value: string | null): value is FilterId {
  return value !== null && (FILTERS as readonly string[]).includes(value);
}

function focusLabel(focus: FocusId): string {
  return FOCUSES.find((item) => item.id === focus)?.label ?? focus;
}

function filterLabel(filter: FilterId): string {
  if (filter === "all") return "All";
  if (filter === "pinned") return "Pinned";
  if (filter === "mine") return "Mine";
  return focusLabel(filter);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasFocus(text: string, focus: FocusId): boolean {
  const lower = text.toLowerCase();
  if (focus === "overview") return /\boverview\b|\bsummary\b/.test(lower);
  if (focus === "risks") return /\brisk|limit|drawback|critic/.test(lower);
  if (focus === "comparison") return /\bcompare\b|\bvs\b|\bversus\b|\bcomparison\b/.test(lower);
  return true;
}

function focusSuffix(focus: FocusId): string {
  if (focus === "overview") return " overview";
  if (focus === "risks") return " risks and limitations";
  if (focus === "comparison") return " comparison";
  return "";
}

function quote(text: string): string {
  return `“${text}”`;
}

function composeAsk(raw: string, depth: DepthId, focus: FocusId): string {
  let ask = cleanText(raw).slice(0, SENT_LIMIT);
  if (!ask) return "";
  if (focus !== "plain" && !hasFocus(ask, focus)) {
    const suffix = focusSuffix(focus);
    ask = `${ask.slice(0, Math.max(0, SENT_LIMIT - suffix.length))}${suffix}`;
  }
  if (depth === "deep" && !/\bdeep research\b/i.test(ask)) {
    const suffix = " deep research";
    ask = `${ask.slice(0, Math.max(0, SENT_LIMIT - suffix.length))}${suffix}`;
  }
  return ask.slice(0, SENT_LIMIT);
}

function checkStep(raw: string, depth: DepthId, focus: FocusId, halted: boolean): string {
  const ask = composeAsk(raw, depth, focus);
  if (!ask) {
    return "Next: type a question in Question to save, or in What do you want to research?, then press Check research. A blank question is not searched and creates no citations.";
  }
  const pathNote = shouldRunDeepResearch(ask)
    ? " This wording runs the multi-search path because it says deep research or is at least 160 characters."
    : " This wording stays a single search because it is under 160 characters and does not say deep research.";
  const stopNote = halted
    ? " Emergency stop is on in this browser. Press Clear stop first, or Check research does not run."
    : " If Emergency stop is on, press Clear stop before Check research.";
  return `Next: type ${quote(ask)} in What do you want to research?, then press Check research. That sends at most 300 characters.${pathNote} If the saved Grok key cannot search, it refuses and creates no citations.${stopNote}`;
}

function refusalStep(halted: boolean): string {
  if (halted) {
    return "Next: Emergency stop is on in this browser. Press Clear stop, type a question in What do you want to research?, then press Check research. If the saved Grok key cannot search, that still refuses and creates no citations.";
  }
  return "Next: type a question in What do you want to research?, then press Check research. If the saved Grok key cannot search, the page refuses and creates no citations. Do not read a refusal as sources found.";
}

function fileStep(): string {
  return "Next: stage a text file, then press Inspect staged file under File inspection. Web pages are not fetched. Press Run REA doctor only for the doctor check. A report appears only after one of those buttons runs.";
}

function readQuestions(): LocalQuestion[] {
  const raw = readKey(QUESTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const questions: LocalQuestion[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as { id?: unknown; text?: unknown; focus?: unknown; createdAt?: unknown };
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const text = typeof record.text === "string" ? cleanText(record.text).slice(0, SENT_LIMIT) : "";
      const focus = typeof record.focus === "string" && isFocus(record.focus) ? record.focus : null;
      if (!id || !text || !focus || id.startsWith("starter-") || seen.has(id)) continue;
      seen.add(id);
      const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : 0;
      questions.push({ id, text, focus, createdAt, mine: true });
      if (questions.length === QUESTION_LIMIT) break;
    }
    return questions;
  } catch {
    return [];
  }
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

function compareQuestions(sort: SortId) {
  return (left: LocalQuestion, right: LocalQuestion) => {
    if (sort === "name") return left.text.localeCompare(right.text) || left.id.localeCompare(right.id);
    return right.createdAt - left.createdAt || left.text.localeCompare(right.text);
  };
}

/**
 * Research page controls. Preferences and questions stay on this device.
 * Check research on the page still owns the search. This panel never fetches or invents a citation.
 */
export function ResearchPanel({ onUse }: { onUse?: (text: string) => void } = {}) {
  const [depth, setDepth] = useState<DepthId>("single");
  const [focus, setFocus] = useState<FocusId>("plain");
  const [sort, setSort] = useState<SortId>("recent");
  const [filter, setFilter] = useState<FilterId>("all");
  const [pins, setPins] = useState<string[]>([]);
  const [mine, setMine] = useState<LocalQuestion[]>([]);
  const [draft, setDraft] = useState("");
  const [halted, setHalted] = useState(false);
  const [next, setNext] = useState(DEFAULT_NEXT);
  const [savedNote, setSavedNote] = useState("Preferences load from this browser.");

  useEffect(() => {
    const storedDepth = readKey(DEPTH_KEY);
    const storedFocus = readKey(FOCUS_KEY);
    const storedSort = readKey(SORT_KEY);
    const storedFilter = readKey(FILTER_KEY);
    const storedMine = readQuestions();
    const known = new Set([...STARTERS, ...storedMine].map((item) => item.id));
    if (isDepth(storedDepth)) setDepth(storedDepth);
    if (isFocus(storedFocus)) setFocus(storedFocus);
    if (isSort(storedSort)) setSort(storedSort);
    if (isFilter(storedFilter)) setFilter(storedFilter);
    setMine(storedMine);
    setPins(readPins(known));
    try {
      setHalted(loadWorkspace(window.localStorage).halted === true);
    } catch {
      setHalted(emptyWorkspace().halted);
    }
    setSavedNote("Loaded depth, focus, sort, filter, and saved questions already stored in this browser.");
  }, []);

  const visible = useMemo(() => {
    return [...STARTERS, ...mine]
      .filter((item) => {
        if (filter === "pinned") return pins.includes(item.id);
        if (filter === "mine") return item.mine;
        if (filter === "all") return true;
        return item.focus === filter;
      })
      .slice()
      .sort(compareQuestions(sort));
  }, [filter, mine, pins, sort]);

  function noteSaved(label: string, ok: boolean) {
    setSavedNote(ok ? `Saved ${label} on this device.` : `Could not save ${label}. This browser is blocking storage.`);
  }

  function chooseDepth(nextDepth: DepthId) {
    setDepth(nextDepth);
    const label = DEPTHS.find((item) => item.id === nextDepth)?.label ?? nextDepth;
    noteSaved(`${label} as the research depth`, writeKey(DEPTH_KEY, nextDepth));
    setNext(checkStep(draft, nextDepth, focus, halted));
  }

  function chooseFocus(nextFocus: FocusId) {
    setFocus(nextFocus);
    noteSaved(`${focusLabel(nextFocus)} as the research focus`, writeKey(FOCUS_KEY, nextFocus));
    setNext(checkStep(draft, depth, nextFocus, halted));
  }

  function chooseSort(nextSort: SortId) {
    setSort(nextSort);
    const label = SORTS.find((item) => item.id === nextSort)?.label ?? nextSort;
    noteSaved(`${label} sort`, writeKey(SORT_KEY, nextSort));
  }

  function chooseFilter(nextFilter: FilterId) {
    setFilter(nextFilter);
    noteSaved(`${filterLabel(nextFilter)} as the question filter`, writeKey(FILTER_KEY, nextFilter));
  }

  function reloadLocal() {
    const storedMine = readQuestions();
    const known = new Set([...STARTERS, ...storedMine].map((item) => item.id));
    setMine(storedMine);
    setPins(readPins(known));
    let stop = false;
    try {
      stop = loadWorkspace(window.localStorage).halted === true;
      setHalted(stop);
      setSavedNote("Reloaded saved questions and Emergency stop from this browser.");
    } catch {
      setHalted(false);
      setSavedNote("Reloaded saved questions. This browser blocked workspace storage, so Emergency stop could not be read.");
    }
    setNext(
      storedMine.length === 0
        ? "Next: type a question in Question to save, then press Save this question. Nothing was searched."
        : checkStep(storedMine[0]?.text ?? "", depth, focus, stop),
    );
  }

  function saveQuestion() {
    const text = cleanText(draft).slice(0, SENT_LIMIT);
    if (!text) {
      setNext("Next: type a question in Question to save, then press Save this question. An empty question is not stored and is not searched.");
      return;
    }
    const existing = mine.find((item) => item.text.toLowerCase() === text.toLowerCase());
    if (existing) {
      setNext(`Next: “${existing.text}” is already saved. Press Use this question next on that row.`);
      return;
    }
    if (mine.length >= QUESTION_LIMIT) {
      setNext(`Next: this device already has ${QUESTION_LIMIT} saved questions. Press Remove on one row, then press Save this question again.`);
      return;
    }
    const added: LocalQuestion = {
      id: `local-${Date.now().toString(36)}`,
      text,
      focus,
      createdAt: Date.now(),
      mine: true,
    };
    const nextMine = [added, ...mine].slice(0, QUESTION_LIMIT);
    setMine(nextMine);
    setDraft("");
    noteSaved(`“${text}”`, writeKey(QUESTIONS_KEY, JSON.stringify(nextMine.map(({ id, text: saved, focus: savedFocus, createdAt }) => ({ id, text: saved, focus: savedFocus, createdAt })))));
    setNext(checkStep(text, depth, focus, halted));
  }

  function removeQuestion(question: LocalQuestion) {
    const nextMine = mine.filter((item) => item.id !== question.id);
    const nextPins = pins.filter((id) => id !== question.id);
    setMine(nextMine);
    setPins(nextPins);
    const savedList = writeKey(
      QUESTIONS_KEY,
      JSON.stringify(nextMine.map(({ id, text, focus: savedFocus, createdAt }) => ({ id, text, focus: savedFocus, createdAt }))),
    );
    const savedPins = writeKey(PINS_KEY, JSON.stringify(nextPins));
    noteSaved(`removal of “${question.text}”`, savedList && savedPins);
    setNext("Next: type another question in Question to save, or press Use this question next on a row that is still listed.");
  }

  function togglePin(question: LocalQuestion) {
    const nextPins = pins.includes(question.id) ? pins.filter((id) => id !== question.id) : [...pins, question.id];
    setPins(nextPins);
    noteSaved(`“${question.text}”`, writeKey(PINS_KEY, JSON.stringify(nextPins)));
  }

  const emptyCopy =
    visible.length === 0
      ? filter === "pinned"
        ? "No pinned questions. Next: press Pin on a row, or press All to leave this filter."
        : filter === "mine"
          ? "No questions saved from this box yet. Next: type one in Question to save, then press Save this question."
          : `No local questions in ${filterLabel(filter)}. Next: press All, or save a question with ${filterLabel(filter)} selected as the focus.`
      : null;

  return (
    <section className="research-panel" aria-labelledby="research-panel-title" data-testid="research-panel">
      <style>{PANEL_CSS}</style>
      <header className="research-panel__head">
        <h2 id="research-panel-title">Saved questions</h2>
        <p>These stay on this device. Use a question to fill the search box. Nothing here searches by itself.</p>
      </header>

      <p className="research-panel__next" role="status">
        {next}
      </p>
      <p className="research-panel__note">{savedNote}</p>

      <div className="research-panel__actions">
        <button type="button" onClick={() => setNext(checkStep(draft, depth, focus, halted))}>
          Show the Check research step for this draft
        </button>
        <button type="button" onClick={() => setNext(refusalStep(halted))}>
          Show what a missing provider does
        </button>
        <button type="button" onClick={() => setNext(fileStep())}>
          Show how to inspect a staged file
        </button>
        <button type="button" onClick={reloadLocal}>
          Reload this browser, then show the next step
        </button>
      </div>

      <fieldset className="research-panel__group">
        <legend>Depth saved on this device</legend>
        <div className="research-panel__row" role="group" aria-label="Research depth">
          {DEPTHS.map((item) => (
            <button key={item.id} type="button" aria-pressed={depth === item.id} onClick={() => chooseDepth(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="research-panel__group">
        <legend>Focus saved on this device</legend>
        <div className="research-panel__row" role="group" aria-label="Research focus">
          {FOCUSES.map((item) => (
            <button key={item.id} type="button" aria-pressed={focus === item.id} onClick={() => chooseFocus(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="research-panel__group">
        <legend>Sort saved on this device</legend>
        <div className="research-panel__row" role="group" aria-label="Question sort">
          {SORTS.map((item) => (
            <button key={item.id} type="button" aria-pressed={sort === item.id} onClick={() => chooseSort(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="research-panel__list">
        <div className="research-panel__list-head">
          <h2>Local questions</h2>
          <label>
            Question to save
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, SENT_LIMIT))}
              placeholder="Type a question to save. This does not search."
              aria-label="Question to save"
              rows={3}
              maxLength={SENT_LIMIT}
            />
          </label>
        </div>
        <div className="research-panel__row">
          <button type="button" onClick={saveQuestion}>
            Save this question
          </button>
        </div>
        <div className="research-panel__row" role="group" aria-label="Filter local questions">
          {FILTERS.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => chooseFilter(item)}>
              {item === "pinned" ? `Pinned (${pins.length})` : filterLabel(item)}
            </button>
          ))}
        </div>
        <p className="research-panel__count">
          {visible.length === 1 ? "1 question" : `${visible.length} questions`}
          {filter === "all" ? "" : ` in ${filterLabel(filter)}`}
          {depth === "deep" ? ". Deep check adds the words deep research when you use a row." : ". Single check does not add those words."}
        </p>
        {emptyCopy ? (
          <p className="research-panel__empty">{emptyCopy}</p>
        ) : (
          <ul>
            {visible.map((question) => {
              const pinned = pins.includes(question.id);
              return (
                <li key={question.id}>
                  <p>
                    <span>{`${question.mine ? "Saved question" : "Local prompt"} · ${focusLabel(question.focus)}`}</span>
                    {question.text}
                  </p>
                  <div className="research-panel__row">
                    <button type="button" onClick={() => { setNext(checkStep(question.text, depth, focus, halted)); onUse?.(question.text); }}>
                      Use this question next
                    </button>
                    <button type="button" aria-pressed={pinned} onClick={() => togglePin(question)}>
                      {pinned ? "Pinned" : "Pin"}
                    </button>
                    {question.mine ? (
                      <button type="button" onClick={() => removeQuestion(question)}>
                        Remove
                      </button>
                    ) : null}
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

export default ResearchPanel;

const PANEL_CSS = `
.research-panel {
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
.research-panel *, .research-panel *::before, .research-panel *::after { box-sizing: border-box; }
.research-panel__head h1,
.research-panel__head h2 {
  margin: 0;
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.research-panel__head p,
.research-panel__note,
.research-panel__count,
.research-panel__empty {
  margin: 0.35rem 0 0;
  color: var(--color-muted, #9aa3b5);
  overflow-wrap: anywhere;
}
.research-panel__next {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 0.85rem;
  background: var(--color-surface-2, #141a24);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.research-panel__actions,
.research-panel__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}
.research-panel button,
.research-panel textarea {
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--color-line, #243044);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.3;
}
.research-panel button {
  min-height: 2.75rem;
  padding: 0.45rem 0.85rem;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.research-panel button[aria-pressed="true"] {
  background: var(--color-accent, #e8ecf5);
  color: var(--color-accent-ink, #0a0d14);
  border-color: transparent;
}
.research-panel__group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.research-panel__group legend,
.research-panel__list h2 {
  padding: 0;
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
}
.research-panel__list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.research-panel__list-head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.65rem;
}
.research-panel__list-head label {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.85rem;
}
.research-panel textarea {
  width: 100%;
  min-height: 5.5rem;
  border-radius: 0.75rem;
  padding: 0.65rem 0.75rem;
  background: var(--color-surface, #0c1018);
  resize: vertical;
}
.research-panel ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.research-panel li {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-line, #243044);
}
.research-panel li p {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.research-panel li span {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
@media (min-width: 64rem) {
  .research-panel { padding: 1.25rem 0.25rem 1.25rem 0; }
}
`;
