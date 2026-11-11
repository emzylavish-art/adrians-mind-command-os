import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, Code2, FileDiff, FolderOpen, RefreshCw, Send, ShieldCheck, Square, Terminal, WifiOff } from "lucide-react";
import { KimiPhase4Panel } from "@/components/mind/kimi-phase4-panel";
import { chatTurnBody } from "@/lib/mind/logic-routes";
import { consumeMindTurn } from "@/lib/mind/live-turn";

type CompanionState = {
  ok?: boolean;
  agents?: { id: string; label: string; lastSeenAt: string }[];
  onlineAgentIds?: string[];
  detail?: string;
  error?: string;
};

type BuildEvent = {
  id: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type BuildJob = {
  id: string;
  status: "queued" | "running" | "cancel_requested" | "cancelled" | "done" | "error" | "timeout";
  output: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceFile = { path: string; bytes: number };

function updateText(event: BuildEvent): string {
  const update = event.payload.update;
  if (!update || typeof update !== "object") return "";
  const content = (update as { content?: unknown }).content;
  if (!content || typeof content !== "object") return "";
  const text = (content as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function eventLabel(event: BuildEvent): string {
  const labels: Record<string, string> = {
    runtime_start: "Runtime starting",
    initialized: "ACP initialized",
    session_created: "Session created",
    session_update: "Agent update",
    permission_request: "Permission requested",
    terminal_request: "Terminal request denied",
    file_write: "File written",
    file_read: "File read",
    file_list: "Workspace listed",
    terminal_start: "Terminal started",
    terminal_complete: "Terminal complete",
    session_complete: "Session complete",
    runtime_error: "Runtime error",
  };
  return labels[event.type] ?? event.type.replaceAll("_", " ");
}

export function BuildWorkspace() {
  const [companion, setCompanion] = useState<CompanionState>({});
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [job, setJob] = useState<BuildJob | null>(null);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [planModel, setPlanModel] = useState("");
  const [planning, setPlanning] = useState(false);
  const [panel, setPanel] = useState<"agent" | "timeline" | "changes" | "editor" | "terminal" | "capabilities">("agent");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [editorText, setEditorText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalApproval, setTerminalApproval] = useState<{ id: string; token: string; command: string } | null>(null);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState<{ path: string; before: string; after: string } | null>(null);
  const [capabilities, setCapabilities] = useState<{ id: string; label: string; status: string; evidence: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; label: string; cwd: string; instructions: string }[]>([]);
  const [sessions, setSessions] = useState<{ jobId: string; name: string; archived: boolean }[]>([]);
  const [providers, setProviders] = useState<{ id: string; label: string; model: string; hasKey: boolean; runtimeUse: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const [model, setModel] = useState("kimi-k2");
  const [apiKey, setApiKey] = useState("");

  const assistantText = useMemo(
    () => events.map(updateText).filter(Boolean).join(""),
    [events],
  );
  const online = (companion.onlineAgentIds?.length ?? 0) > 0;
  const active = job?.status === "queued" || job?.status === "running";
  const editorDirty = selectedFile !== "" && editorText !== savedText;
  const changedFiles = useMemo(
    () => events
      .filter((event) => event.type === "file_write")
      .map((event) => typeof event.payload.path === "string" ? event.payload.path : "unknown path"),
    [events],
  );
  const deniedTerminals = events.filter((event) => event.type === "terminal_request").length;
  const hasWorkspaceSurface = Boolean(job) || panel !== "agent" || workspaceFiles.length > 0;

  async function refreshCompanion() {
    try {
      const response = await fetch("/api/mind/pc/status", { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as CompanionState;
      setCompanion(data);
    } catch {
      setCompanion({ ok: false, error: "Companion status could not be read." });
    }
  }

  async function refreshJob(jobId: string) {
    try {
      const response = await fetch(`/api/mind/kimi/session?jobId=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as { ok?: boolean; job?: BuildJob; events?: BuildEvent[]; error?: string };
      if (!response.ok || !data.ok || !data.job) {
        setNotice(data.error || "Build session status could not be read.");
        return;
      }
      setJob(data.job);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setNotice("Build session status is temporarily unavailable. No completion was assumed.");
    }
  }

  async function runFileOperation(operation: "list" | "read" | "write" | "search" | "rename" | "delete", path?: string, content?: string, extra?: { query?: string; to?: string; confirm?: boolean }) {
    if (!online) { setFileNotice("No paired Companion is online. No file operation was executed."); return null; }
    setFileBusy(true);
    setFileNotice(null);
    try {
      const response = await fetch("/api/mind/kimi/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, cwd: cwd.trim() || undefined, path, content, ...extra }) });
      const queued = (await response.json()) as { ok?: boolean; jobId?: string; error?: string };
      if (!response.ok || !queued.ok || !queued.jobId) { setFileNotice(queued.error || "File operation could not be queued."); return null; }
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const statusResponse = await fetch(`/api/mind/kimi/files?jobId=${encodeURIComponent(queued.jobId)}`, { credentials: "include", cache: "no-store" });
        const status = (await statusResponse.json()) as { ok?: boolean; job?: { status: string; output?: string; error?: string }; error?: string };
        if (!statusResponse.ok || !status.ok || !status.job) { setFileNotice(status.error || "File operation status could not be read."); return null; }
        if (["done", "error", "timeout"].includes(status.job.status)) {
          if (status.job.status !== "done") { setFileNotice(status.job.error || "File operation failed."); return null; }
          return JSON.parse(status.job.output || "{}");
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      setFileNotice("File operation timed out. No completion was assumed.");
      return null;
    } catch {
      setFileNotice("File operation could not reach Adrian OS.");
      return null;
    } finally {
      setFileBusy(false);
    }
  }

  async function browseWorkspace() {
    const result = await runFileOperation("list") as { files?: WorkspaceFile[] } | null;
    if (result?.files) { setWorkspaceFiles(result.files); setPanel("editor"); }
  }

  async function openFile(path: string) {
    if (editorDirty && typeof window !== "undefined" && !window.confirm("This file has edits that were not verified as saved. Open another file anyway?")) return;
    const result = await runFileOperation("read", path) as { content?: string } | null;
    if (result && typeof result.content === "string") { setSelectedFile(path); setEditorText(result.content); setSavedText(result.content); setPanel("editor"); }
  }

  async function saveFile() {
    if (!selectedFile) { setFileNotice("Select a file before saving."); return; }
    const result = await runFileOperation("write", selectedFile, editorText) as { path?: string; before?: string; after?: string } | null;
    if (result?.path) {
      const verified = result.after || editorText;
      setSavedText(verified);
      setLastDiff({ path: result.path, before: result.before || "", after: verified });
      setFileNotice(`Saved ${result.path}. The before/after text is the reviewed result, not an assumed write.`);
    }
  }

  async function requestTerminalApproval() {
    if (!terminalCommand.trim()) { setFileNotice("Enter a terminal command before requesting approval."); return; }
    setTerminalBusy(true);
    try {
      const response = await fetch("/api/mind/kimi/terminal", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: terminalCommand.trim() }) });
      const data = (await response.json()) as { ok?: boolean; approval?: { id: string; token: string; command: string }; error?: string };
      if (!response.ok || !data.ok || !data.approval) { setFileNotice(data.error || "Terminal approval request failed."); return; }
      setTerminalApproval(data.approval);
      setFileNotice("Terminal approval created. Review the exact command before approving.");
    } catch { setFileNotice("Terminal approval request could not reach Adrian OS."); } finally { setTerminalBusy(false); }
  }

  async function approveTerminal() {
    if (!terminalApproval) return;
    setTerminalBusy(true);
    try {
      const response = await fetch("/api/mind/pc/approve", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId: terminalApproval.id, token: terminalApproval.token, command: terminalApproval.command }) });
      const data = (await response.json()) as { ok?: boolean; text?: string; error?: string };
      setTerminalOutput(data.text || data.error || "No terminal output returned.");
      setFileNotice(data.ok ? "Approved terminal command completed." : data.error || "Approved terminal command failed.");
      setTerminalApproval(null);
    } catch { setFileNotice("Terminal approval could not be completed."); } finally { setTerminalBusy(false); }
  }

  useEffect(() => {
    void refreshCompanion();
    const timer = window.setInterval(() => void refreshCompanion(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!editorDirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [editorDirty]);

  useEffect(() => {
    const savedJobId = typeof localStorage === "undefined" ? "" : localStorage.getItem("adrian-build-last-job") || "";
    if (savedJobId) void refreshJob(savedJobId);
  }, []);

  useEffect(() => {
    void fetch("/api/mind/kimi/capabilities", { credentials: "include" }).then((response) => response.json()).then((data) => { if (data.capabilities) setCapabilities(data.capabilities); }).catch(() => undefined);
    void fetch("/api/mind/kimi/projects", { credentials: "include" }).then((response) => response.json()).then((data) => { setProjects(data.projects || []); setSessions(data.sessions || []); }).catch(() => undefined);
    void fetch("/api/mind/kimi/providers", { credentials: "include" }).then((response) => response.json()).then((data) => setProviders(data.providers || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!job?.id || !active) return;
    const timer = window.setInterval(() => void refreshJob(job.id), 1_500);
    return () => window.clearInterval(timer);
  }, [active, job?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) {
      setNotice("Describe the coding task before submitting.");
      return;
    }
    setLoading(true);
    setNotice(null);
    setEvents([]);
    try {
      const response = await fetch("/api/mind/kimi/session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, cwd: cwd.trim() || undefined }),
      });
      const data = (await response.json()) as { ok?: boolean; jobId?: string; error?: string };
      if (!response.ok || !data.ok || !data.jobId) {
        setNotice(data.error || "Kimi session could not be queued.");
        return;
      }
      setJob({ id: data.jobId, status: "queued", output: "", error: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      localStorage.setItem("adrian-build-last-job", data.jobId);
      setNotice("Task queued. Waiting for the Companion to start Kimi ACP.");
    } catch {
      setNotice("The Build request could not reach Adrian OS. Nothing was executed.");
    } finally {
      setLoading(false);
    }
  }

  async function planWithGrok() {
    const text = prompt.trim();
    if (!text) {
      setNotice("Describe the task before asking Grok for a plan.");
      return;
    }
    setPlanning(true);
    setPlan("");
    setPlanModel("");
    setNotice("Asking Grok for a plan. This does not edit files.");
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(30_000);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([controller.signal, timeout]) : timeout;
    try {
      const result = await consumeMindTurn({
        url: "/api/mind/turn",
        signal,
        headers: { "content-type": "application/json" },
        body: chatTurnBody({
          text: `Plan this Adrian Build task. Do not claim any file was written.\n\n${text}`,
          memory: "off",
          halted: false,
          history: [],
          memoryContext: [],
          provider: "grok",
          modelTier: "Heavy",
          logicRoute: null,
          images: [],
        }),
        onDelta: (chunk) => setPlan((current) => current + chunk),
      });
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setPlan(result.text);
      setPlanModel(result.model);
      setNotice("Grok returned a plan. No file was written.");
    } catch {
      setNotice("The Grok plan could not be completed. No file was written.");
    } finally {
      setPlanning(false);
    }
  }

  async function cancelBuild() {
    if (!job?.id || !active) return;
    try {
      const response = await fetch("/api/mind/kimi/cancel", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      setNotice(data.ok ? "Cancellation requested. Waiting for the Companion to stop the runtime." : data.error || "Cancellation was not accepted.");
    } catch { setNotice("Cancellation request could not reach Adrian OS."); }
  }

  async function searchWorkspace() {
    const result = await runFileOperation("search", undefined, undefined, { query: searchQuery }) as { matches?: { path: string }[] } | null;
    setSearchMatches(result?.matches?.map((item) => item.path) || []);
    setPanel("editor");
  }

  async function registerProject() {
    const response = await fetch("/api/mind/kimi/projects", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: cwd.trim() || "Workspace", cwd }) });
    const data = await response.json() as { ok?: boolean; project?: { id: string; label: string; cwd: string; instructions: string }; error?: string };
    if (data.project) setProjects((current) => [data.project!, ...current]);
    setNotice(data.ok ? "Workspace registered for this account." : data.error || "Workspace was not registered.");
  }

  async function archiveRegisteredProject(id: string) {
    const response = await fetch("/api/mind/kimi/projects", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive", id }) });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (data.ok) setProjects((current) => current.filter((project) => project.id !== id));
    setNotice(data.ok ? "Project archived." : data.error || "Project was not archived.");
  }

  async function renameSession(jobId: string, name: string) {
    const next = name.trim();
    if (!next) return;
    const response = await fetch("/api/mind/kimi/projects", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "session", jobId, name: next }) });
    const data = await response.json() as { ok?: boolean; session?: { jobId: string; name: string; archived: boolean }; error?: string };
    if (data.session) setSessions((current) => current.map((session) => session.jobId === jobId ? data.session! : session));
    setNotice(data.ok ? "Session renamed." : data.error || "Session was not renamed.");
  }

  async function submitVoice() {
    if (!transcript.trim()) return;
    const instructions = projects.find((project) => project.cwd === cwd)?.instructions || "";
    const response = await fetch("/api/mind/kimi/voice", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, cwd, instructions }) });
    const data = await response.json() as { ok?: boolean; jobId?: string; error?: string; limitation?: string };
    if (data.jobId) {
      setJob({ id: data.jobId, status: "queued", output: "", error: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      localStorage.setItem("adrian-build-last-job", data.jobId);
    }
    setNotice(data.ok ? data.limitation || "Voice transcript queued." : data.error || "Voice transcript was not queued.");
  }

  async function saveProvider() {
    const response = await fetch("/api/mind/kimi/providers", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, apiKey }) });
    const data = await response.json() as { ok?: boolean; provider?: { id: string; label: string; model: string; hasKey: boolean; runtimeUse: string }; error?: string };
    if (data.provider) setProviders((current) => [data.provider!, ...current]);
    setApiKey("");
    setNotice(data.ok ? "Provider profile saved. The key is encrypted and is not injected into Kimi." : data.error || "Provider profile was not saved.");
  }

  function speakResult() {
    const text = assistantText || job?.output || "";
    if (!text || typeof window === "undefined" || !window.speechSynthesis) { setNotice("Speech output is not available in this browser."); return; }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 1_000)));
  }

  return (
    <section className="page-shell space-y-4" data-testid="build-workspace">
      <div className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Terminal className="size-8 text-accent" aria-hidden="true" />
            <div>
              <h2 className="font-display text-3xl font-bold">Adrian Build</h2>
              <p className="text-sm text-muted">Plans use Grok. File edits still need a runtime that can write. A plan is not a file change.</p>
            </div>
          </div>
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => { void refreshCompanion(); if (job) void refreshJob(job.id); }}>
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className={`dense-card flex flex-wrap items-center gap-3 ${online ? "border-success/40" : "border-warning/40"}`}>
        {online ? <Activity className="size-5 text-success" aria-hidden="true" /> : <WifiOff className="size-5 text-warning" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{online ? "Companion connected" : "Companion offline"}</p>
          <p className="text-sm text-muted">{online ? (companion.detail || "A paired runtime reported a heartbeat.") : (companion.error || "No Companion heartbeat. Submit still attempts the hosted runtime and shows its real result. It does not ask for a Kimi login.")}</p>
        </div>
        <span className="rounded-full border border-line px-2 py-1 text-xs">{online ? "Ready to queue" : "Hosted attempt on submit"}</span>
      </div>

      <div className="dense-card space-y-3">
        <h3 className="font-semibold">Projects and sessions</h3>
        {projects.length === 0 ? <p className="text-sm text-muted">No workspace is registered yet. Registering stores the label and path for this account. It does not prove the path is reachable.</p> : projects.map((project) => (
          <div key={project.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">{project.label} · {project.cwd || "no path"}</span>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setCwd(project.cwd); setNotice(`Opened ${project.label}. File access still requires the runtime that owns this path.`); }}>Open</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void archiveRegisteredProject(project.id)}>Archive</button>
          </div>
        ))}
        {sessions.length === 0 ? <p className="text-sm text-muted">No saved session names yet.</p> : sessions.filter((session) => !session.archived).map((session) => (
          <form key={session.jobId} className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void renameSession(session.jobId, String(data.get("name") || "")); }}>
            <input name="name" defaultValue={session.name} aria-label={`Rename session ${session.name}`} className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm" />
            <button type="submit" className="min-h-11 rounded-panel border border-line px-3 text-sm">Rename</button>
          </form>
        ))}
      </div>

      <form className="dense-card space-y-3" onSubmit={submit}>
        <div className="flex items-center gap-2">
          <FolderOpen className="size-4 text-accent" aria-hidden="true" />
          <h3 className="font-semibold">Approved workspace</h3>
        </div>
        <div className="flex gap-2"><input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Optional local path, e.g. C:\\Users\\You\\MindWorkspace" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Approved workspace path" /><button type="button" disabled={fileBusy} onClick={() => void browseWorkspace()} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm disabled:opacity-50"><FolderOpen className="size-4" />{fileBusy ? "Loading…" : "Browse"}</button></div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the coding task…" className="min-h-32 w-full rounded-panel border border-line bg-transparent p-3 text-sm outline-none focus:border-accent" aria-label="Coding task" />
        <div className="flex flex-wrap gap-2">
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search approved workspace" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Workspace search" />
          <button type="button" disabled={fileBusy || !searchQuery.trim()} onClick={() => void searchWorkspace()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Search</button>
          <button type="button" disabled={!cwd.trim()} onClick={() => void registerProject()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Register workspace</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Dictate or paste an Adrian Speak transcript" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Voice transcript" />
          <button type="button" disabled={!transcript.trim()} onClick={() => void submitVoice()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Send transcript</button>
          <button type="button" onClick={speakResult} className="min-h-11 rounded-panel border border-line px-3 text-sm">Read result</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={model} onChange={(event) => setModel(event.target.value)} className="min-h-11 w-40 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Kimi model" />
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="Optional Moonshot key" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Provider key" />
          <button type="button" disabled={!model.trim()} onClick={() => void saveProvider()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Save profile</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={loading || Boolean(active)} className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50">
            <Send className="size-4" aria-hidden="true" /> {loading ? "Queueing…" : active ? "Task running…" : "Run with Kimi"}
          </button>
          <button type="button" disabled={planning || !prompt.trim()} onClick={() => void planWithGrok()} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-4 text-sm disabled:opacity-50">
            {planning ? "Planning…" : "Plan with Grok"}
          </button>
          <span className="text-xs text-muted">File access is workspace-bound. Terminal requests remain approval-gated.</span>
        </div>
      </form>

      {notice ? <p className="dense-card text-sm" role="status">{notice}</p> : null}
      {plan ? <section className="dense-card space-y-2"><h3 className="font-semibold">Grok plan{planModel ? ` · ${planModel}` : ""}</h3><p className="text-xs text-muted">This is a reply. It did not edit a file, run a terminal, or commit.</p><pre className="whitespace-pre-wrap text-sm">{plan}</pre></section> : null}
      {fileNotice ? <p className="dense-card text-sm" role="status">{fileNotice}</p> : null}

      {!hasWorkspaceSurface ? <div className="promo-banner text-sm"><ShieldCheck className="size-5 text-accent" aria-hidden="true" /><div><p className="font-semibold">Honest runtime boundary</p><p className="text-muted">This workspace never fabricates agent output. It shows queued, running, permission, error, and completed states from the ACP event stream.</p></div></div> : null}
      {(
        <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)]">
          <nav className="dense-card h-fit space-y-1" aria-label="Build panels">
            {(["agent", "timeline", "changes", "editor", "terminal", "capabilities"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setPanel(item)} className={`flex min-h-11 w-full items-center justify-between rounded-panel px-3 text-left text-sm ${panel === item ? "bg-accent text-accent-ink" : "text-muted hover:bg-white/5"}`}>
                <span className="flex items-center gap-2">{item === "agent" ? <Activity className="size-4" /> : item === "changes" ? <FileDiff className="size-4" /> : item === "editor" ? <Code2 className="size-4" /> : <Terminal className="size-4" />}{item[0].toUpperCase() + item.slice(1)}</span>
                {item === "changes" && changedFiles.length ? <span>{changedFiles.length}</span> : null}
              </button>
            ))}
          </nav>
          <section className="dense-card min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs uppercase tracking-[0.18em] text-muted">Build panel</p><h3 className="font-semibold">{panel === "agent" ? "Agent output" : panel === "timeline" ? "Execution timeline" : panel === "changes" ? "File-change review" : panel === "editor" ? "Code editor" : panel === "terminal" ? "Integrated terminal" : "Capability inventory"}</h3></div>
              {active ? <Square className="size-4 animate-pulse text-warning" aria-label="Task active" /> : <ShieldCheck className="size-5 text-success" aria-label="Task settled" />}
            </div>
            {panel === "agent" ? <>
              <div className="min-h-32 whitespace-pre-wrap rounded-panel border border-line bg-black/10 p-3 text-sm">{assistantText || job?.output || job?.error || "No active Kimi task. Submit a task to stream agent output here."}</div>
              {active ? <button type="button" onClick={() => void cancelBuild()} className="min-h-10 rounded-panel border border-danger/40 px-3 text-sm text-danger">Stop task</button> : null}
              {job?.error ? <p className="text-sm text-danger" role="alert">{job.error}</p> : null}
            </> : null}
            {panel === "timeline" ? <ol className="max-h-96 space-y-2 overflow-auto text-sm">{events.map((item) => <li key={item.id} className="rounded-panel border border-line p-2"><div className="flex items-center justify-between gap-2"><span className="font-medium">{eventLabel(item)}</span><time className="text-xs text-muted">{new Date(item.createdAt).toLocaleTimeString()}</time></div>{updateText(item) ? <p className="mt-1 text-xs text-muted">{updateText(item).slice(0, 240)}</p> : null}</li>)}{!events.length ? <li className="text-sm text-muted">No events yet.</li> : null}</ol> : null}
            {panel === "changes" ? <div className="space-y-2">{changedFiles.map((path) => <div key={path} className="rounded-panel border border-line p-3 text-sm"><FileDiff className="mr-2 inline size-4 text-accent" />{path}<span className="ml-2 text-xs text-muted">written by ACP</span></div>)}{lastDiff ? <div className="rounded-panel border border-line p-3 text-xs"><p className="font-semibold">Reviewed save: {lastDiff.path}</p><p className="mt-2 whitespace-pre-wrap text-danger">{lastDiff.before}</p><hr className="my-2 border-line" /><p className="whitespace-pre-wrap text-success">{lastDiff.after}</p></div> : null}{!changedFiles.length && !lastDiff ? <p className="text-sm text-muted">No file-write events have been reported for this session.</p> : null}<p className="text-xs text-muted">Reviewed file saves return before/after content for bounded change review.</p></div> : null}
            {panel === "editor" ? <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]"><div className="max-h-80 space-y-1 overflow-auto rounded-panel border border-line p-2">{workspaceFiles.map((file) => <button key={file.path} type="button" onClick={() => void openFile(file.path)} className={`block w-full truncate rounded px-2 py-2 text-left text-xs ${selectedFile === file.path ? "bg-accent text-accent-ink" : "text-muted hover:bg-white/5"}`}>{file.path}<span className="ml-1 opacity-60">{file.bytes} B</span></button>)}{searchMatches.map((path) => <p key={path} className="px-2 text-xs text-muted">Match: {path}</p>)}{!workspaceFiles.length && !searchMatches.length ? <p className="p-2 text-xs text-muted">Choose Browse to list the approved workspace.</p> : null}</div><div className="space-y-2"><textarea value={editorText} onChange={(event) => setEditorText(event.target.value)} disabled={!selectedFile} className="min-h-56 w-full rounded-panel border border-line bg-black/20 p-4 font-mono text-xs outline-none focus:border-accent disabled:opacity-60" placeholder="Select a file to read it here." aria-label="Workspace file editor" /><div className="flex items-center gap-2"><button type="button" disabled={!selectedFile || fileBusy || !editorDirty} onClick={() => void saveFile()} className="min-h-10 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50">{fileBusy ? "Saving…" : "Save reviewed file"}</button><span className="text-xs text-muted">{selectedFile ? `${selectedFile} · ${editorText.split("\n").length} lines · ${editorDirty ? "Unsaved" : "Matches last read or verified save"}` : "No file selected"}</span></div></div></div> : null}
            {panel === "capabilities" ? <div className="space-y-2">{capabilities.map((item) => <div key={item.id} className="rounded-panel border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item.label}</span><span className="text-xs text-muted">{item.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-muted">{item.evidence}</p></div>)}{!capabilities.length ? <p className="text-sm text-muted">Capability inventory has not loaded.</p> : null}<div className="rounded-panel border border-line p-3 text-xs text-muted"><p>Projects: {projects.map((project) => project.label).join(", ") || "none"}</p><p>Sessions: {sessions.map((session) => session.name).join(", ") || "none"}</p><p>Providers: {providers.map((provider) => `${provider.model}${provider.hasKey ? " (key stored)" : ""} · ${provider.runtimeUse}`).join(", ") || "none"}</p></div></div> : null}
            {panel === "capabilities" ? <KimiPhase4Panel initializeResponse={null} updates={events} /> : null}
            {panel === "terminal" ? <div className="space-y-3"><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} placeholder="Command requiring explicit approval" className="min-h-11 w-full rounded-panel border border-line bg-transparent px-3 font-mono text-sm outline-none focus:border-accent" aria-label="Terminal command" /><div className="flex flex-wrap gap-2"><button type="button" disabled={terminalBusy || !terminalCommand.trim()} onClick={() => void requestTerminalApproval()} className="min-h-10 rounded-panel border border-line px-3 text-sm disabled:opacity-50">{terminalBusy ? "Requesting…" : "Request approval"}</button>{terminalApproval ? <button type="button" disabled={terminalBusy} onClick={() => void approveTerminal()} className="min-h-10 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50">Approve exact command</button> : null}</div>{terminalApproval ? <p className="rounded-panel border border-warning/40 bg-warning/10 p-3 text-xs">Pending approval: <code>{terminalApproval.command}</code></p> : null}<div className="min-h-40 whitespace-pre-wrap rounded-panel border border-line bg-black/20 p-4 font-mono text-xs text-muted">{terminalOutput || (deniedTerminals ? `${deniedTerminals} ACP terminal request${deniedTerminals === 1 ? "" : "s"} denied by the agent safety policy.` : "No approved terminal output yet.")}</div><p className="text-xs text-muted">Commands execute only after this explicit approval and remain bounded by the paired Companion workspace.</p></div> : null}
          </section>
        </div>
      )}
    </section>
  );
}
