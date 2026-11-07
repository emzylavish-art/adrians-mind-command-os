import { useEffect, useRef, useState } from "react";
import {
  STORAGE_KEY, LIMITS, emptyLibrary, loadLibrary, serializeLibrary,
  createDraft, reviseDraft, reviewDraft, suggestCuration,
} from "@/lib/mind/skill-library";
import type { DraftContent, SkillLibrary } from "@/lib/mind/skill-library";
import { decide } from "@/lib/mind/decision-router";
import type { Skill, Decision } from "@/lib/mind/decision-router";

type Props = {
  skills: readonly Skill[];
  enabledSkills: Record<string, boolean>;
};

const blank: DraftContent = { title: "", summary: "", body: "" };
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Operation failed";

export default function LocalSkillsTools({ skills, enabledSkills }: Props) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionKey, setDecisionKey] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [library, setLibrary] = useState<SkillLibrary>(emptyLibrary);
  const [loadedRaw, setLoadedRaw] = useState<string | null | undefined>();
  const [locked, setLocked] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<DraftContent>(blank);
  const [editorBaseline, setEditorBaseline] = useState<DraftContent>(blank);
  const [libraryDirty, setLibraryDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editorDirty = (Object.keys(blank) as (keyof DraftContent)[])
    .some(field => content[field] !== editorBaseline[field]);
  const routingKey = JSON.stringify([
    skills.map(({ id, name, kind }) => [id, name, kind]),
    Object.keys(enabledSkills).filter(id => enabledSkills[id] === false).sort(),
  ]);
  useEffect(() => { setDecision(null); setDecisionKey(null); }, [routingKey]);
  const [curation, setCuration] =
    useState<ReturnType<typeof suggestCuration> | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setLoadedRaw(raw);
      const result = loadLibrary(raw);
      if (!result.ok) {
        setError(`Draft storage is invalid: ${result.error}. Raw data preserved.`);
        return;
      }
      setLibrary(result.library);
      setLocked(false);
    } catch (cause) {
      setError(`Storage unavailable: ${message(cause)}`);
    }
  }, []);

  function change(operation: () => SkillLibrary, successNotice = "Draft library changed in memory; select Save locally to persist it.") {
    if (locked) return;
    try {
      setLibrary(operation());
      setLibraryDirty(true);
      setCuration(null);
      setNotice(successNotice);
      setError("");
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function save() {
    if (locked || loadedRaw === undefined || savingRef.current) return;
    if (!navigator.locks?.request) {
      setError("This browser cannot safely coordinate draft saves across tabs. Your in-memory changes are preserved; export or keep this tab open.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await navigator.locks.request(`zapia:${STORAGE_KEY}`, async () => {
        const current = window.localStorage.getItem(STORAGE_KEY);
        if (current !== loadedRaw) {
          setConflict(true);
          setError("Draft storage changed in another tab. Nothing was overwritten; your changes remain here. Download these local changes before reconciling.");
          return;
        }
        const serialized = serializeLibrary(library);
        window.localStorage.setItem(STORAGE_KEY, serialized);
        setLoadedRaw(serialized);
        setConflict(false);
        setLibraryDirty(false);
        setNotice(editorDirty
          ? "Draft library saved. Editor text is still unappended and was not saved."
          : "Draft library saved locally.");
        setError("");
      });
    } catch (cause) {
      setError(`Not saved: ${message(cause)}. In-memory changes remain in this tab.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const target = library.drafts.find(draft => draft.id === selected);
  const full = !!target && target.versions.length >= LIMITS.versions;
  const fieldClass = "w-full rounded-panel border border-line bg-bg p-2";

  return (
    <section className="dense-card space-y-4">
      <header>
        <h2 className="font-semibold">Local skills tools</h2>
        <p className="text-sm text-muted">
          Suggestions and inert drafts only. Nothing runs or becomes active.
        </p>
      </header>

      <form
        className="space-y-2 rounded-panel border border-line bg-bg p-3"
        onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const text = new FormData(form).get("request");
          setDecision(decide(typeof text === "string" ? text : "", skills, enabledSkills));
          setDecisionKey(routingKey);
          setRequest("");
        }}
      >
        <label className="block">
          Request (local classification only)
          <textarea name="request" className={fieldClass} rows={3} maxLength={2000} value={request} onChange={(event) => setRequest(event.target.value)} />
        </label>
        <div className="flex gap-3">
          <button type="submit">Classify locally</button>
          <button type="button" onClick={() => { setRequest(""); setDecision(null); }}>Clear</button>
        </div>
        <p className="text-sm text-muted">
          Request text is not saved and is cleared after classification.
        </p>
        {decision && decisionKey === routingKey && (
          <p role="status">
            {decision.type === "suggestion"
              ? `Suggestion only: ${skills.find(s => s.id === decision.skillId)?.name ?? decision.skillId}`
              : `No suggestion: ${decision.reason}`}
          </p>
        )}
      </form>

      <div className="space-y-3 rounded-panel border border-line bg-bg p-3">
        <h3 className="font-semibold">Draft library</h3>
        <p className="text-sm text-muted">
          Edits remain in memory until Save. Reviewed drafts are reviewed-inactive,
          never executable.
        </p>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {locked && <p className="text-muted">Draft editing and saving are locked.</p>}

        <fieldset disabled={locked || saving} className="space-y-3">
          <label className="block">
            Draft
            <select
              className={fieldClass}
              value={selected}
              onChange={event => {
                const id = event.target.value;
                if (editorDirty && !window.confirm("Discard unappended editor text?")) return;
                const draft = library.drafts.find(item => item.id === id);
                const nextContent = draft ? draft.versions[draft.versions.length - 1].content : blank;
                setSelected(id);
                setContent(nextContent);
                setEditorBaseline(nextContent);
              }}
            >
              <option value="">New draft</option>
              {library.drafts.map(draft => {
                const latest = draft.versions[draft.versions.length - 1];
                return (
                  <option key={draft.id} value={draft.id}>
                    {latest.content.title} · v{latest.version} · {latest.status}
                  </option>
                );
              })}
            </select>
          </label>

          {(["title", "summary", "body"] as const).map(field => (
            <label key={field} className="block">
              {field} ({content[field].length}/{LIMITS[field]})
              <textarea
                className={fieldClass}
                rows={field === "body" ? 5 : 2}
                maxLength={LIMITS[field]}
                value={content[field]}
                onChange={event =>
                  setContent({ ...content, [field]: event.target.value })
                }
              />
            </label>
          ))}

          {editorDirty && <p role="status">Editor text has not been appended to the library. Saving now will save only library versions.</p>}
          {libraryDirty && <p role="status">Library changes are in memory and need an explicit save.</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!content.title.trim() || (selected ? full : library.drafts.length >= LIMITS.drafts)}
              onClick={() => change(() => {
                const next = selected
                  ? reviseDraft(library, selected, content)
                  : createDraft(library, content);
                if (!selected) {
                  const id = next.drafts[next.drafts.length - 1].id;
                  setSelected(id);
                  setEditorBaseline({ ...content });
                } else setEditorBaseline({ ...content });
                return next;
              })}
            >
              {selected ? "Append revision" : "Create draft"}
            </button>
            <button
              type="button"
              disabled={!target || full}
              onClick={() => {
                const version = target ? target.versions[target.versions.length - 1].version : 0;
                change(() => reviewDraft(library, selected), `Reviewed stored version ${version}; appended a reviewed-inactive version. Editor text was not reviewed.`);
              }}
            >
              Review latest stored version
            </button>
            <button type="button" disabled={saving || (!libraryDirty && loadedRaw !== null)} onClick={() => void save()}>{saving ? "Saving…" : "Save locally"}</button>
            <button
              type="button"
              onClick={() => {
                try {
                  setCuration(suggestCuration(library));
                } catch (cause) {
                  setError(message(cause));
                }
              }}
            >
              Suggest curation
            </button>
          </div>
        </fieldset>

        <p className="text-sm text-muted">
          Review preserves the latest library content, not unappended editor changes.
        </p>
        {conflict && <button type="button" onClick={() => {
          try {
            const recovery = { library: JSON.parse(serializeLibrary(library)), unappendedEditor: editorDirty ? content : null };
            const blob = new Blob([JSON.stringify(recovery, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "mind-skill-drafts-recovery.json";
            anchor.click();
            URL.revokeObjectURL(url);
          } catch (cause) { setError(`Could not export local recovery: ${message(cause)}`); }
        }}>Download local changes</button>}
        {curation !== null && (
          <div role="status">
            <p>Curation suggestions only; no changes applied.</p>
            {curation.length === 0 ? <p>No suggestions.</p> : (
              <ul>
                {curation.map(item => (
                  <li key={item.draftId}>
                    {item.draftId} · v{item.version}: {item.action}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
