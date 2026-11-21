import { useEffect, useMemo, useState } from "react";

const TARGET_KEY = "adrian-build-panel-target";
const SCOPE_KEY = "adrian-build-panel-scope";
const APPROVAL_KEY = "adrian-build-panel-approval";
const PINS_KEY = "adrian-build-panel-pins";

const TARGETS = [
  { id: "plan", label: "Plan only" },
  { id: "hosted", label: "Hosted attempt" },
  { id: "paired", label: "Paired computer" },
] as const;

const SCOPES = [
  { id: "explain", label: "Explain only" },
  { id: "file", label: "One file" },
  { id: "folder", label: "This folder" },
] as const;

type TargetId = (typeof TARGETS)[number]["id"];
type ScopeId = (typeof SCOPES)[number]["id"];
type BriefKind = "Plan" | "Edit" | "Review" | "Terminal";
type FilterId = "All" | BriefKind | "Saved";

const FILTERS: FilterId[] = ["All", "Plan", "Edit", "Review", "Terminal", "Saved"];

const BRIEFS: { id: string; kind: BriefKind; text: string }[] = [
  { id: "explain", kind: "Plan", text: "Explain the failing behavior and name the file most likely involved. Do not edit anything." },
  { id: "plan", kind: "Plan", text: "Write a short plan with the first change and how we would know it worked. Do not edit a file." },
  { id: "fix", kind: "Edit", text: "Fix the smallest failing check and leave unrelated files untouched." },
  { id: "onefile", kind: "Edit", text: "Change only the file I name, then show the before and after." },
  { id: "review", kind: "Review", text: "List files this session reported as written. If none are reported, say nothing changed." },
  { id: "diff", kind: "Review", text: "Read the reviewed before and after before accepting a save." },
  { id: "test", kind: "Terminal", text: "Run only the exact test command after both approval presses." },
  { id: "git", kind: "Terminal", text: "Do not run git until a computer is paired and the exact command is approved twice." },
];

const DEFAULT_NEXT =
  "Next: paste a task into Describe the coding task, then press Plan with Grok if you want a reply only. A plan does not edit a file, run a terminal, or commit.";

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

function isTarget(value: string | null): value is TargetId {
  return value !== null && TARGETS.some((item) => item.id === value);
}

function isScope(value: string | null): value is ScopeId {
  return value !== null && SCOPES.some((item) => item.id === value);
}

function readPins(): string[] {
  const raw = readKey(PINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const known = new Set(BRIEFS.map((item) => item.id));
    return parsed.filter((id): id is string => typeof id === "string" && known.has(id));
  } catch {
    return [];
  }
}

function scopeClause(scope: ScopeId): string {
  if (scope === "explain") return " Ask only for an explanation, and do not request a file write.";
  if (scope === "file") return " Name one file in the task before you submit.";
  return " Enter that folder in Approved workspace path, then press Register workspace. Registration stores the path. It does not prove the path is reachable.";
}

function targetStep(target: TargetId, scope: ScopeId): string {
  if (target === "plan") {
    return `Next: paste the task into Describe the coding task, then press Plan with Grok and leave the run button unpressed.${scopeClause(scope)}`;
  }
  if (target === "hosted") {
    return `Next: paste the task into Describe the coding task, then press the run button. With no paired computer, that submit tries the hosted runtime and shows the real result. It is not proof a file changed.${scopeClause(scope)}`;
  }
  return `Next: press Refresh. If the banner still says Companion offline, pair a computer before Browse or Terminal. File edits and commands do not run until a paired computer is online.${scopeClause(scope)}`;
}

function briefStep(kind: BriefKind, text: string): string {
  if (kind === "Plan") {
    return `Next: paste “${text}” into Describe the coding task, then press Plan with Grok. Do not press the run button.`;
  }
  if (kind === "Edit") {
    return `Next: paste “${text}” into Describe the coding task, fill Approved workspace path, then press the run button. If Companion is offline, that submit tries the hosted runtime and is not a file edit.`;
  }
  if (kind === "Review") {
    return `Next: open Changes and look for a reported file write. If it says no file-write events, nothing was reported as changed. Use “${text}” only as the review note.`;
  }
  return `Next: open Terminal, type the exact command for “${text}”, press Request approval, then press Approve exact command. Nothing runs before that second press.`;
}

/**
 * Build page controls. Preferences stay on this device.
 * Buttons save a preference, filter the task list, or state the exact next step.
 */
export function BuildPanel() {
  const [target, setTarget] = useState<TargetId>("plan");
  const [scope, setScope] = useState<ScopeId>("explain");
  const [requireApproval, setRequireApproval] = useState(true);
  const [pins, setPins] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterId>("All");
  const [query, setQuery] = useState("");
  const [next, setNext] = useState(DEFAULT_NEXT);
  const [savedNote, setSavedNote] = useState("Preferences load from this browser.");

  useEffect(() => {
    const storedTarget = readKey(TARGET_KEY);
    const storedScope = readKey(SCOPE_KEY);
    const storedApproval = readKey(APPROVAL_KEY);
    if (isTarget(storedTarget)) setTarget(storedTarget);
    if (isScope(storedScope)) setScope(storedScope);
    if (storedApproval === "on" || storedApproval === "off") setRequireApproval(storedApproval === "on");
    setPins(readPins());
    setSavedNote("Loaded the target, scope, approval preference, and saved tasks already stored in this browser.");
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return BRIEFS.filter((item) => {
      if (filter === "Saved" && !pins.includes(item.id)) return false;
      if (filter !== "All" && filter !== "Saved" && item.kind !== filter) return false;
      if (!needle) return true;
      return `${item.kind} ${item.text}`.toLowerCase().includes(needle);
    });
  }, [filter, pins, query]);

  function noteSaved(label: string, ok: boolean) {
    setSavedNote(ok ? `Saved ${label} on this device.` : `Could not save ${label}. This browser is blocking storage.`);
  }

  function chooseTarget(nextTarget: TargetId) {
    setTarget(nextTarget);
    const label = TARGETS.find((item) => item.id === nextTarget)?.label ?? nextTarget;
    noteSaved(`${label} as the build target`, writeKey(TARGET_KEY, nextTarget));
  }

  function chooseScope(nextScope: ScopeId) {
    setScope(nextScope);
    const label = SCOPES.find((item) => item.id === nextScope)?.label ?? nextScope;
    noteSaved(`${label} as the build scope`, writeKey(SCOPE_KEY, nextScope));
  }

  function toggleApproval() {
    const nextOn = !requireApproval;
    setRequireApproval(nextOn);
    noteSaved(nextOn ? "approval required" : "approval reminder off", writeKey(APPROVAL_KEY, nextOn ? "on" : "off"));
    setNext(
      nextOn
        ? "Next: keep Terminal closed until you mean to run something. Type the exact command, press Request approval, then press Approve exact command."
        : "Next: this reminder is off on this device only. Terminal still does nothing until you press Request approval and then Approve exact command.",
    );
  }

  function togglePin(id: string) {
    const nextPins = pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];
    setPins(nextPins);
    const item = BRIEFS.find((brief) => brief.id === id);
    noteSaved(item ? `“${item.text}”` : "that task", writeKey(PINS_KEY, JSON.stringify(nextPins)));
  }

  async function stateComputerStep() {
    const offline = "Next: press Refresh on Build. If the banner says Companion offline, pair a computer before Browse or Terminal. Until then, press Plan with Grok for a reply, or press the run button knowing it only tries the hosted runtime.";
    try {
      const response = await fetch("/api/mind/pc/status", { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as { onlineAgentIds?: unknown; detail?: unknown; error?: unknown };
      const online = Array.isArray(data.onlineAgentIds) && data.onlineAgentIds.length > 0;
      if (!response.ok) {
        setNext(typeof data.error === "string" && data.error ? `Next: press Refresh. Status said: ${data.error}` : offline);
        return;
      }
      if (online) {
        const detail = typeof data.detail === "string" && data.detail ? ` ${data.detail}` : "";
        setNext(`Next: a paired computer is online.${detail} Enter the approved workspace path, press Browse, then paste the task. Open Terminal only for a command you will approve twice.`);
        return;
      }
      setNext(offline);
    } catch {
      setNext(offline);
    }
  }

  return (
    <section className="build-panel" aria-labelledby="build-panel-title" data-testid="build-panel">
      <style>{PANEL_CSS}</style>
      <header className="build-panel__head">
        <h1 id="build-panel-title"><img src="/brand/logo-mark.jpg" alt="" width="32" height="32" />Build</h1>
        <p>Set the target and scope, keep a short task list, and follow the exact next step before a file or command runs.</p>
      </header>

      <p className="build-panel__next" role="status">
        {next}
      </p>
      <p className="build-panel__note">{savedNote}</p>

      <div className="build-panel__actions">
        <button type="button" onClick={() => void stateComputerStep()}>
          Check computer, then show the next step
        </button>
        <button type="button" onClick={() => setNext(targetStep(target, scope))}>
          Show the next step for this setup
        </button>
        <button type="button" onClick={() => setNext(DEFAULT_NEXT)}>
          Show how to keep edits off
        </button>
        <button type="button" aria-pressed={requireApproval} onClick={toggleApproval}>
          {requireApproval ? "Approval reminder is on" : "Approval reminder is off"}
        </button>
      </div>

      <div className="build-panel__prefs">
        <fieldset className="build-panel__group">
          <legend>Target saved on this device</legend>
          <div className="build-panel__row" role="group" aria-label="Build target">
            {TARGETS.map((item) => (
              <button key={item.id} type="button" aria-pressed={target === item.id} onClick={() => chooseTarget(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="build-panel__group">
          <legend>Scope saved on this device</legend>
          <div className="build-panel__row" role="group" aria-label="Build scope">
            {SCOPES.map((item) => (
              <button key={item.id} type="button" aria-pressed={scope === item.id} onClick={() => chooseScope(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="build-panel__list">
        <div className="build-panel__list-head">
          <h2>Task lines</h2>
          <label>
            Filter text
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by a word"
              aria-label="Filter task lines"
            />
          </label>
        </div>
        <div className="build-panel__row" role="group" aria-label="Filter task lines">
          {FILTERS.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>
              {item === "Saved" ? `Saved (${pins.length})` : item}
            </button>
          ))}
        </div>
        <p className="build-panel__count">
          {visible.length === 1 ? "1 line" : `${visible.length} lines`}
          {filter === "All" ? "" : ` in ${filter}`}
          {query.trim() ? ` matching “${query.trim()}”` : ""}.
        </p>
        {visible.length === 0 ? (
          <p className="build-panel__empty">
            {filter === "Saved"
              ? "No saved lines yet. Next: press Save on a line you want back, or press All to see every line."
              : "No lines match this filter. Next: clear the text or press All."}
          </p>
        ) : (
          <ul>
            {visible.map((item) => {
              const saved = pins.includes(item.id);
              return (
                <li key={item.id}>
                  <p>
                    <span>{item.kind}</span>
                    {item.text}
                  </p>
                  <div className="build-panel__row">
                    <button type="button" onClick={() => setNext(briefStep(item.kind, item.text))}>
                      Use this line next
                    </button>
                    <button type="button" aria-pressed={saved} onClick={() => togglePin(item.id)}>
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

export default BuildPanel;

const PANEL_CSS = `
.build-panel {
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
.build-panel *, .build-panel *::before, .build-panel *::after { box-sizing: border-box; }
.build-panel__head h1 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.build-panel__head h1 img {
  width: 2rem;
  height: 2rem;
  border-radius: 0.6rem;
}
.build-panel__head p,
.build-panel__note,
.build-panel__count,
.build-panel__empty {
  margin: 0.35rem 0 0;
  color: var(--color-muted, #9aa3b5);
  overflow-wrap: anywhere;
}
.build-panel__next {
  margin: 0;
  padding: 0.75rem 0.85rem;
  border: 1px solid var(--color-line, #243044);
  border-radius: 0.85rem;
  background: var(--color-surface-2, #141a24);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.build-panel__actions,
.build-panel__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  min-width: 0;
}
.build-panel button,
.build-panel input {
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
.build-panel button {
  padding: 0.45rem 0.85rem;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.build-panel button[aria-pressed="true"] {
  background: var(--color-accent, #e8ecf5);
  color: var(--color-accent-ink, #0a0d14);
  border-color: transparent;
}
.build-panel__prefs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.85rem;
  min-width: 0;
}
.build-panel__group {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.build-panel__group legend,
.build-panel__list h2 {
  padding: 0;
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
}
.build-panel__list {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.build-panel__list-head {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.65rem;
}
.build-panel__list-head label {
  display: flex;
  flex: 1 1 12rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.85rem;
}
.build-panel input {
  width: 100%;
  border-radius: 0.75rem;
  padding: 0.45rem 0.75rem;
  background: var(--color-surface, #0c1018);
}
.build-panel ul {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.build-panel li {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-line, #243044);
}
.build-panel li p {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.build-panel li span {
  display: block;
  margin-bottom: 0.15rem;
  color: var(--color-muted, #9aa3b5);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
@media (min-width: 40rem) {
  .build-panel__prefs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 64rem) {
  .build-panel { padding: 1.25rem 0.25rem 1.25rem 0; }
}
`;
