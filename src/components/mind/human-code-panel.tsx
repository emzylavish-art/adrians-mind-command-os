import { codeDraftScope, takeTemporaryCodeHandoff, MAX_CODE_HANDOFF_CHARS } from "@/lib/mind/code-handoff";
import { useComposerDraft } from "@/lib/mind/use-composer-draft";
import { useAccountPreferences } from "./account-preferences-context";
import { useEffect, useRef, useState } from "react";
import { NuanceCallCard } from "./nuance-call";

export const HUMAN_CODE_NOTE = "Intelligence. This thread discusses code. File edits go to Build and are not claimed until Build reports them.";

export function isIntelligenceThread(value?: string) {
  return Boolean(value?.startsWith("Human Code.") || value?.startsWith("Intelligence."));
}

export type HumanThread = {
  id: string;
  title: string;
  temporary?: boolean;
  messages: { id?: string; role: string; content: string }[];
};

type WorkspaceFile = { path: string; bytes: number };
type Attachment = { name: string; dataUrl?: string; text?: string };

const SECRET_FILE = /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i;

export function HumanCodePanel(props: {
  ownerId: string | null;
  threads: HumanThread[];
  activeId: string;
  busy: boolean;
  notice: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onSend: (id: string, text: string, image?: { dataUrl: string; name: string }) => boolean | Promise<boolean>;
  onBuild: (text: string) => void;
  halted?: boolean;
}) {
  const preferenceStorage = useAccountPreferences();
  const active = props.threads.find((thread) => thread.id === props.activeId) ?? props.threads[0] ?? null;
  const scope = codeDraftScope(props.ownerId, active?.id ?? "none", active?.temporary === true);
  const [draft, setDraft] = useComposerDraft(scope, "human-code", "", Boolean(props.ownerId) && !active?.temporary);
  const surfaceIdentity = useRef(scope); surfaceIdentity.current = scope;
  const [fontSize, setFontSize] = useState(15);
  const [wrap, setWrap] = useState(true);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [fileQuery, setFileQuery] = useState("");
  const [filePath, setFilePath] = useState("");
  const [startLine, setStartLine] = useState(1);
  const [endLine, setEndLine] = useState(20);
  const [gitNote, setGitNote] = useState("Reading the hosted workspace.");
  const [changedNote, setChangedNote] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [fileNote, setFileNote] = useState("");
  useEffect(() => {
    const savedSize = Number(preferenceStorage.getItem("adrian-human-font"));
    if (savedSize >= 13 && savedSize <= 22) setFontSize(savedSize);
    setWrap(preferenceStorage.getItem("adrian-human-wrap") !== "off");
  }, [preferenceStorage]);
  useEffect(() => {
    setAttachment(null);
    if (!props.ownerId || !active?.temporary) return;
    const handed = takeTemporaryCodeHandoff(props.ownerId, active.id);
    if (handed !== undefined) setDraft(handed);
  }, [props.ownerId, active?.id, active?.temporary, setDraft]);
  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        const [listed, git] = await Promise.all([
          fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "list" }) }).then((response) => response.json()),
          fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "git" }) }).then((response) => response.json()),
        ]);
        if (stop) return;
        const nextFiles = Array.isArray(listed.files) ? listed.files.slice(0, 200) : [];
        setFiles(nextFiles);
        const status = typeof git.status === "string" ? git.status : "";
        const branch = typeof git.branch === "string" && git.branch ? git.branch : "no branch";
        const truncated = listed.truncated === true;
        setGitNote(git.ok ? `${nextFiles.length} files indexed${truncated ? ". The workspace is larger than 200 files, so the rest were not loaded" : ", capped at 200"}. Branch ${branch}.` : "Build could not list the workspace. Discussion-only mode is still available.");
        const key = `adrian-human-git:${props.activeId || "none"}`;
        const previous = preferenceStorage.getItem(key);
        if (previous && previous !== status) setChangedNote("The workspace changed since this thread was last open.");
        else setChangedNote(previous ? "No workspace change since this thread was last open." : "");
        preferenceStorage.setItem(key, status);
      } catch {
        if (!stop) setGitNote("Build is unavailable. You can still discuss code.");
      }
    })();
    return () => { stop = true; };
  }, [props.activeId, preferenceStorage]);
  const latest = [...(active?.messages ?? [])].reverse().find((message) => message.role !== "user")?.content ?? "";
  const shown = files.filter((file) => file.path.toLowerCase().includes(fileQuery.trim().toLowerCase())).slice(0, 12);

  async function askLines() {
    if (!active || !filePath) return;
    if (SECRET_FILE.test(filePath)) {
      setFileNote("Secret files stay on this computer. Nothing was sent.");
      return;
    }
    const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "read", path: filePath }) });
    const data = await response.json() as { content?: string; error?: string; truncated?: boolean };
    if (!response.ok || typeof data.content !== "string") {
      setFileNote(data.error || `${filePath} is not in the hosted workspace. Nothing was sent.`);
      return;
    }
    if (data.truncated) {
      setFileNote(`${filePath} is larger than this discussion can hold. Ask for a smaller line range, or open it in Build. Nothing was changed.`);
      return;
    }
    setFileNote("");
    const lines = data.content.split("\n").slice(Math.max(0, startLine - 1), Math.max(startLine, endLine));
    props.onSend(active.id, `Explain ${filePath} lines ${startLine}-${endLine}. Do not claim a file changed.\n${lines.map((line, index) => `${startLine + index}|${line}`).join("\n")}`);
  }

  return (
    <section className="human-code-shell intelligence-shell page-shell" data-testid="human-code">
      <div className="page-hero card-texture">
        <p className="text-xs uppercase tracking-wide text-muted">Coding</p>
        <h2 className="font-display text-3xl font-bold">Intelligence</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">Discussion stays in this pane. File changes go to Build.</p>
      </div>
      <div className="human-code-layout intelligence-layout mt-4 grid gap-4">
        <aside className="intelligence-group rounded-panel border border-line p-3">
          <h3>Threads</h3>
          <button type="button" className="min-h-11 w-full rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" onClick={props.onNew}>New thread</button>
          <p className="mt-3 text-xs text-muted" data-testid="human-index">{gitNote}</p>
          {changedNote ? <p className="mt-1 text-xs" role="status">{changedNote}</p> : null}
          <h3 className="mt-4">Files</h3>
          <input aria-label="Search workspace files" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search files" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-transparent px-2 text-sm" />
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
            {shown.map((file) => (
              <li key={file.path}><button type="button" className="min-h-11 w-full truncate rounded-panel px-2 text-left text-xs" onClick={() => setFilePath(file.path)}>{file.path}</button></li>
            ))}
          </ul>
          <ul className="human-code-threads mt-3 space-y-1">
            {props.threads.length ? props.threads.map((thread) => (
              <li key={thread.id}>
                <button type="button" aria-current={thread.id === active?.id ? "true" : undefined} title={thread.title || "Intelligence"} className="min-h-11 w-full truncate rounded-panel px-2 text-left text-sm" onClick={() => props.onOpen(thread.id)}>{thread.title || "Intelligence"}</button>
              </li>
            )) : <li className="px-2 text-sm text-muted">No coding threads yet.</li>}
          </ul>
        </aside>
        <div className="intelligence-main">
          <NuanceCallCard halted={props.halted === true} />
          <section className="intelligence-group" aria-label="Discussion">
            <h3>Discussion</h3>
            <div className="max-h-80 space-y-3 overflow-auto" style={{ fontSize, whiteSpace: wrap ? "pre-wrap" : "pre", overflowX: wrap ? "hidden" : "auto" }}>
              {active?.messages.length ? active.messages.map((message, index) => (
                <p key={message.id ?? `${message.role}-${index}`} id={message.id ? "message-" + message.id : undefined} tabIndex={-1}><strong>{message.role === "user" ? "You" : "Intelligence"}: </strong>{message.content}</p>
              )) : <p className="text-sm text-muted">Ask about code here. File changes still go to Build.</p>}
            </div>
            <p className="mt-3 text-xs text-muted" data-testid="human-model">Discussion uses Grok. Execution uses Adrian Build.</p>
          </section>
          <section className="intelligence-group" aria-label="Actions">
            <h3>Actions</h3>
            <div className="flex flex-wrap gap-2">
            {["/explain", "/review", "/diff", "/test", "/run", "/files"].map((command) => (
              <button key={command} type="button" disabled={!active || props.busy} className="min-h-11 rounded-panel border border-line px-3 text-xs disabled:opacity-50" onClick={() => { if (active) props.onSend(active.id, command); }}>{command}</button>
            ))}
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => { const next = Math.max(13, fontSize - 1); setFontSize(next); preferenceStorage.setItem("adrian-human-font", String(next)); }}>Smaller</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={() => { const next = Math.min(22, fontSize + 1); setFontSize(next); preferenceStorage.setItem("adrian-human-font", String(next)); }}>Larger</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" aria-pressed={wrap} onClick={() => { const next = !wrap; setWrap(next); preferenceStorage.setItem("adrian-human-wrap", next ? "on" : "off"); }}>{wrap ? "Wrap on" : "Wrap off"}</button>
            </div>
          </section>
          <section className="intelligence-group" aria-label="Lines">
            <h3>Lines</h3>
            <div className="human-code-lines grid gap-2">
            <input aria-label="File to ask about" value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="file path" className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm" />
            <input aria-label="Start line" type="number" min={1} value={startLine} onChange={(event) => setStartLine(Number(event.target.value) || 1)} className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm" />
            <input aria-label="End line" type="number" min={1} value={endLine} onChange={(event) => setEndLine(Number(event.target.value) || 1)} className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm" />
            <button type="button" disabled={!active || !filePath} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50" onClick={() => void askLines()}>Ask about lines</button>
            </div>
            {fileNote ? <p className="mt-2 text-sm" role="status" data-testid="human-file-note">{fileNote}</p> : null}
          </section>
          <section className="intelligence-group" aria-label="Message">
            <h3>Message</h3>
            {props.notice ? <p className="mb-2 text-sm text-muted" role="status">{props.notice}</p> : null}
            <form className="human-code-composer flex flex-col gap-2" onSubmit={async (event) => {
            event.preventDefault();
            if (!active || (!draft.trim() && !attachment)) return;
            const text = attachment?.text ? `${draft.trim()}\nAttached log ${attachment.name}:\n${attachment.text}` : draft.trim() || `What is in the attached image ${attachment?.name}?`;
            const capturedScope = scope, capturedDraft = draft;
            const accepted = await props.onSend(active.id, text, attachment?.dataUrl ? { dataUrl: attachment.dataUrl, name: attachment.name } : undefined);
            if (!accepted || surfaceIdentity.current !== capturedScope) return;
            setDraft((current) => current === capturedDraft ? "" : current);
            setAttachment(null);
          }}>
            <textarea aria-label="Intelligence message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about the code" className="min-h-24 rounded-panel border border-line bg-transparent px-3 py-2 text-sm" />
            {attachment ? <p className="text-xs text-muted">Attached {attachment.name}. It stays in this message.</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={props.busy || !active || (!draft.trim() && !attachment)} className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">Send</button>
              <button type="button" disabled={!draft.trim() && !latest} className="min-h-11 rounded-panel border border-line px-4 text-sm disabled:opacity-50" onClick={() => props.onBuild(draft.trim() || latest)}>Send to Build</button>
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-panel border border-line px-3 text-sm">Attach log or screenshot
                <input aria-label="Attach log or screenshot" type="file" accept="image/*,.txt,.log,.md,.json" hidden onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (file.size > 10_000_000) { setFileNote("This attachment exceeds 10 MB. Choose a smaller file; nothing was shortened or attached."); return; }
                  const capturedScope = scope;
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (surfaceIdentity.current !== capturedScope) return;
                    const result = String(reader.result || "");
                    if (file.type.startsWith("image/") && result.startsWith("data:image/")) setAttachment({ name: file.name, dataUrl: result });
                    else if (result.length > MAX_CODE_HANDOFF_CHARS) setFileNote("This log exceeds the supported handoff limit. Select a smaller excerpt; nothing was shortened or attached.");
                    else setAttachment({ name: file.name, text: result });
                  };
                  if (file.type.startsWith("image/")) reader.readAsDataURL(file);
                  else reader.readAsText(file);
                }} />
              </label>
            </div>
          </form>
          </section>
        </div>
      </div>
    </section>
  );
}
