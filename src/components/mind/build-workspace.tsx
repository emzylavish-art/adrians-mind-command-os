import { knownCodeFilesFor, reviewedRelatedNavigation, type CodeBufferSource } from "@/lib/mind/kimi/code-navigation";
import type { BuilderInstructionReceipt } from "@/lib/mind/kimi/hosted/builder-instructions";
import type { FileReconciliation } from "@/lib/mind/kimi/file-reconciliation";
import { checkpointListOutcome, type BuildRuntime } from "@/lib/mind/kimi/runtime-capabilities";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, Code2, FileDiff, FolderOpen, RefreshCw, Send, ShieldCheck, Square, Terminal, WifiOff } from "lucide-react";
import { KimiPhase4Panel } from "@/components/mind/kimi-phase4-panel";
import { GitReview, type GitReport } from "@/components/mind/git-review";
import { CodeIde } from "@/components/mind/code-ide";
import { OwnerFlow } from "@/components/mind/owner-flow";
import { ActionOverlay } from "@/components/mind/conversation-menu";
import { chatTurnBody } from "@/lib/mind/logic-routes";
import { consumeMindTurn, prepareTurnId } from "@/lib/mind/live-turn";

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

type FileTarget = { workspace: string; cwd?: string };
type EditorBuffer = FileTarget & { path: string; saved: string; draft: string; revision?: string };
type FileResult = FileTarget & { files?: WorkspaceFile[]; matches?: { path: string }[]; path?: string; content?: string; before?: string; after?: string; truncated?: boolean; nextCursor?: string; total?: number; revision?: string };
function bufferKey(target: FileTarget, path: string) {
  return JSON.stringify([target.workspace, target.cwd || "", path]);
}

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

function shortDiff(path: string, before: string, after: string): string {
  if (before === after) return `${path} was reported, but the text did not change.`;
  const changed = after.split("\n").filter((line) => !before.split("\n").includes(line)).slice(0, 12);
  return [`Changed ${path}.`, ...changed.map((line) => `+ ${line}`)].join("\n");
}


export function BuildWorkspace(props: {
  ownerId?: string;
  freeOnly?: boolean;
  onDiscuss?: (text: string) => void;
  onResult?: (text: string) => void;
  halted?: boolean;
  recording?: boolean;
  recordingSeconds?: number;
  recordingStartedAt?: number | null;
  onOpenSpeak?: () => void;
  onToggleStop?: () => void;
  onStopRecording?: () => void;
} = {}) {
  const [companion, setCompanion] = useState<CompanionState>({});
  const [band, setBand] = useState<"actions" | "files" | "message" | "editor">("message");
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [job, setJob] = useState<BuildJob | null>(null);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [planModel, setPlanModel] = useState("");
  const planFlight = useRef(false);
  const planAttempts = useRef(new Map<string, string>());
  const planOwner = useRef(props.ownerId);
  planOwner.current = props.ownerId;
  const [planning, setPlanning] = useState(false);
  const [panel, setPanel] = useState<"agent" | "timeline" | "changes" | "editor" | "terminal" | "capabilities" | "browser">("editor");
  const [newFileName, setNewFileName] = useState("");
  const [browserFrame, setBrowserFrame] = useState("");
  const [browserNotice, setBrowserNotice] = useState("");
  const [runtimes, setRuntimes] = useState<BuildRuntime[]>([]);
  const [selectedRuntime, setSelectedRuntime] = useState("hosted");
  const selectedRuntimeRef = useRef(selectedRuntime);
  selectedRuntimeRef.current = selectedRuntime;
  const selectedCapabilities = runtimes.find((runtime) => runtime.id === selectedRuntime);
  const [fileCursor, setFileCursor] = useState<string>();
  const [fileTotal, setFileTotal] = useState(0);
  const [searchCursor, setSearchCursor] = useState<string>();
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;
  const [tabs, setTabs] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>({});
  const buffersRef = useRef(buffers);
  const [fileRequests, setFileRequests] = useState(0);
  const fileBusy = fileRequests > 0;
  const [listingTarget, setListingTarget] = useState<FileTarget>();
  const [matchTarget, setMatchTarget] = useState<FileTarget>();
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [fileReconciliation, setFileReconciliation] = useState<FileReconciliation | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalApproval, setTerminalApproval] = useState<{ id: string; token: string; command: string; hosted?: boolean; agentId?: string; agentLabel?: string; expiresAt?: string } | null>(null);
  const [terminalHistory, setTerminalHistory] = useState<{ command: string; text: string; ok: boolean }[]>([]);
  const [gitReport, setGitReport] = useState<GitReport | null>(null);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState<{ path: string; before: string; after: string } | null>(null);
  const [capabilities, setCapabilities] = useState<{ id: string; label: string; status: string; evidence: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; label: string; cwd: string; instructions: string }[]>([]);
  const [sessions, setSessions] = useState<{ jobId: string; name: string; archived: boolean }[]>([]);
  const [providers, setProviders] = useState<{ id: string; label: string; model: string; hasKey: boolean; runtimeUse: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [transcript, setTranscript] = useState("");
  const [model, setModel] = useState("grok");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"default" | "plan" | "auto">("default");
  const [sessionId, setSessionId] = useState("");
  const [instructionReceipt, setInstructionReceipt] = useState<BuilderInstructionReceipt | null>(null);

  const assistantText = useMemo(
    () => events.map(updateText).filter(Boolean).join(""),
    [events],
  );
  const online = (companion.onlineAgentIds?.length ?? 0) > 0;
  const active = job?.status === "queued" || job?.status === "running" || job?.status === "cancel_requested";
  buffersRef.current = buffers;
  const editorText = buffers[selectedFile]?.draft ?? "";
  const editorDirty = Object.values(buffers).some((buffer) => buffer.draft !== buffer.saved);
  const dirtyTabs = Object.entries(buffers).filter(([, buffer]) => buffer.draft !== buffer.saved).map(([path]) => path);
  const changedFiles = useMemo(
    () => events
      .filter((event) => event.type === "file_write")
      .map((event) => typeof event.payload.path === "string" ? event.payload.path : "unknown path"),
    [events],
  );
  const deniedTerminals = events.filter((event) => event.type === "terminal_request").length;
  const hasWorkspaceSurface = Boolean(job) || panel !== "agent" || workspaceFiles.length > 0;

  async function refreshCompanion() {
    void fetch("/api/mind/build/capabilities", { credentials: "include", cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok || !data.ok) throw new Error(); if (data.capabilities) setCapabilities(data.capabilities); setRuntimes(Array.isArray(data.runtimes) ? data.runtimes : []); })
      .catch(() => setRuntimes([]));
    try {
      const response = await fetch("/api/mind/pc/status", { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as CompanionState;
      setCompanion(data);
    } catch {
      setCompanion({ ok: false, error: "Companion status could not be read." });
    }
  }

  const pollSequence = useRef(0);
  async function refreshJob(jobId: string) {
    const sequence = ++pollSequence.current;
    try {
      const response = await fetch(`/api/mind/build/session?jobId=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
      const data = (await response.json()) as { ok?: boolean; job?: BuildJob; events?: BuildEvent[]; error?: string };
      if (sequence !== pollSequence.current) return;
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

  async function runFileOperation(operation: "list" | "read" | "write" | "search" | "rename" | "delete", path?: string, content?: string, extra?: { query?: string; to?: string; confirm?: boolean; workspace?: string; cwd?: string; expectedMissing?: boolean; expectedContent?: string; expectedRevision?: string; cursor?: string }): Promise<FileResult | null> {
    setFileRequests((pending) => pending + 1);
    setFileNotice(null);
    try {
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, workspace: selectedRuntime, cwd: cwd.trim() || undefined, path, content, ...extra }) });
      const queued = await response.json();
      if (queued.reconciliationRequired && queued.reconciliation) setFileReconciliation(queued.reconciliation);
      if (response.ok && queued.ok && !queued.jobId) {
        const workspace = response.headers.get("X-Mind-Workspace");
        if (!workspace) { setFileNotice("The server did not identify the workspace. Reload after updating Mind OS."); return null; }
        return { ...(queued.result || queued), workspace };
      }
      if (!response.ok || !queued.ok || !queued.jobId) { setFileNotice(queued.error || "File operation could not be queued."); return null; }
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const statusResponse = await fetch(`/api/mind/build/files?jobId=${encodeURIComponent(queued.jobId)}`, { credentials: "include", cache: "no-store" });
        const status = (await statusResponse.json()) as { ok?: boolean; job?: { status: string; output?: string; error?: string }; error?: string };
        if (!statusResponse.ok || !status.ok || !status.job) { setFileNotice(status.error || "File operation status could not be read."); return null; }
        if (["done", "error", "timeout", "cancelled"].includes(status.job.status)) {
          if (status.job.status !== "done") { setFileNotice(status.job.error || "File operation failed."); return null; }
          try {
            const result = JSON.parse(status.job.output || "");
            if (!queued.workspace || !result || typeof result !== "object") throw new Error();
            return { ...result, workspace: queued.workspace, cwd: result.cwd || extra?.cwd || undefined };
          } catch {
            setFileNotice("The PC completed the operation but its result is unreadable. Check the file before retrying.");
            return null;
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      setFileNotice("File operation timed out. No completion was assumed.");
      return null;
    } catch {
      setFileNotice("File operation could not reach Adrian OS.");
      return null;
    } finally {
      setFileRequests((pending) => pending - 1);
    }
  }

  async function browseWorkspace(more = false) {
    const target = selectedRuntime;
    const result = await runFileOperation("list", undefined, undefined, { workspace: target, ...(more && fileCursor ? { cursor: fileCursor } : {}) });
    if (!result?.files || selectedRuntimeRef.current !== target) return;
    setListingTarget({ workspace: result.workspace, cwd: result.cwd });
    setWorkspaceFiles((current) => more ? [...current, ...result.files!.filter((item) => !current.some((file) => file.path === item.path))] : result.files!);
    setFileCursor(result.nextCursor);
    setFileTotal(result.total ?? result.files.length);
    if (result.truncated && !result.nextCursor) setFileNotice("This runtime returned a bounded listing. Use Search for additional paths.");
    setPanel("editor");
  }

  async function closeCodingBrowser() {
    try {
      const response = await fetch("/api/mind/build/browser", { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Close failed");
      setBrowserFrame("");
      setBrowserNotice("Coding browser closed.");
    } catch {
      setBrowserNotice("Could not verify that the coding browser closed.");
    }
  }

  async function openCodingBrowser() {
    setPanel("browser");
    setBrowserNotice("Opening the coding browser on this computer.");
    try {
      const response = await fetch("/api/mind/build/browser", { method: "POST", credentials: "include" });
      const data = (await response.json()) as { ok?: boolean; frame?: string; package?: string; error?: string };
      if (!response.ok || !data.ok || !data.frame) {
        setBrowserFrame("");
        setBrowserNotice(data.error || "The coding browser did not start. No separate login was requested.");
        return;
      }
      setBrowserFrame(data.frame);
      setBrowserNotice(`${data.package || "In-repo coding package"} is open on this computer. It is not a public page.`);
    } catch {
      setBrowserNotice("The coding browser could not be reached.");
    }
  }

  function showFile(target: FileTarget, path: string, text: string, revision?: string) {
    const key = bufferKey(target, path);
    setBuffers((prev) => ({ ...prev, [key]: prev[key] ?? { ...target, path, saved: text, draft: text, revision } }));
    setTabs((prev) => prev.includes(key) ? prev : [...prev, key]);
    setSelectedFile(key);
    setPanel("editor");
  }

  async function openFile(path: string, target?: FileTarget) {
    const cached = target && bufferKey(target, path);
    if (cached && buffersRef.current[cached]) {
      setSelectedFile(cached);
      setPanel("editor");
      return;
    }
    const result = await runFileOperation("read", path, undefined, target);
    if (result?.truncated) { setFileNotice("This file exceeds the editable size limit."); return; }
    if (typeof result?.content === "string") showFile({ workspace: result.workspace, cwd: result.cwd }, path, result.content, result.revision);
  }

  function openRelatedFile(path: string, source: CodeBufferSource) {
    const current = buffersRef.current[selectedFileRef.current];
    const related = current ? knownCodeFilesFor(current, { target: listingTarget, files: workspaceFiles }, Object.values(buffersRef.current)) : [];
    const checked = reviewedRelatedNavigation(source, current ? { ...current, text: current.draft } : undefined, path, related);
    if (!checked.ok) { setFileNotice(checked.error); return; }
    void openFile(checked.path, checked.target);
  }

  function closeTab(path: string) {
    const buffer = buffersRef.current[path];
    if (buffer && buffer.draft !== buffer.saved && typeof window !== "undefined" && !window.confirm(`Close ${buffer.path} without a verified save?`)) return;
    setBuffers((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setTabs((prev) => {
      const next = prev.filter((item) => item !== path);
      if (selectedFile === path) setSelectedFile(next.at(-1) || "");
      return next;
    });
  }

  async function createFile() {
    const name = newFileName.trim().replace(/^\/+/, "");
    if (!name || name.includes("..") || name.includes("\\")) {
      setFileNotice("Use a file name inside this workspace.");
      return;
    }
    if (!listingTarget || (listingTarget.workspace !== "hosted" && !listingTarget.cwd)) { setFileNotice("Browse the destination workspace before creating this file."); return; }
    const result = await runFileOperation("write", name, "", { ...listingTarget, expectedMissing: true });
    if (!result?.path) return;
    const createdPath = result.path;
    setNewFileName("");
    showFile({ workspace: result.workspace, cwd: result.cwd }, createdPath, "", result.revision);
    setPanel("editor");
    setFileNotice(`Created ${createdPath}. Type in the editor, then save.`);
  }

  async function saveFile() {
    if (!selectedFile) { setFileNotice("Select a file before saving."); return; }
    const buffer = buffers[selectedFile];
    if (!buffer) return;
    if (buffer.workspace !== "hosted" && !buffer.cwd) { setFileNotice("Update the companion and reopen the file to identify its workspace root before saving."); return; }
    const result = await runFileOperation("write", buffer.path, editorText, { workspace: buffer.workspace, cwd: buffer.cwd, expectedContent: buffer.saved });
    if (result?.path) {
      const verified = result.after ?? editorText;
      setBuffers((prev) => prev[selectedFile] ? { ...prev, [selectedFile]: { ...prev[selectedFile], saved: verified, revision: result.revision } } : prev);
      setLastDiff({ path: result.path, before: result.before || "", after: verified });
      setFileNotice(`Saved ${result.path}. The before/after text is the reviewed result, not an assumed write.`);
    }
  }

  async function checkFileState() {
    const buffer = buffers[selectedFile];
    if (!buffer) return;
    const result = await runFileOperation("read", buffer.path, undefined, { workspace: buffer.workspace, cwd: buffer.cwd });
    if (!result || result.truncated || typeof result.content !== "string") return;
    const disk = result.content;
    setLastDiff({ path: buffer.path, before: disk, after: buffer.draft });
    if (disk !== buffer.saved && disk !== buffer.draft &&
        !window.confirm("The file changed on disk. Keep your draft and use the current disk version as the baseline for your next save?")) {
      setFileNotice("Your draft was kept. Open Changes to compare it with the disk copy.");
      return;
    }
    setBuffers((prev) => prev[selectedFile] ? { ...prev, [selectedFile]: { ...prev[selectedFile], saved: disk, revision: result.revision } } : prev);
    setFileNotice(disk === buffer.draft ? "The verified disk copy matches the checked draft." : "Disk copy checked. Your draft is available for review.");
  }

  async function mutateReviewedFile(operation: "rename" | "delete") {
    const key = selectedFile;
    const buffer = buffersRef.current[key];
    if (!buffer?.revision) { setFileNotice("Check the disk copy before reviewing this change."); return; }
    if (buffer.draft !== buffer.saved) { setFileNotice("Save or preserve your draft before renaming or deleting this file."); return; }
    const to = operation === "rename" ? window.prompt(`Rename ${buffer.path} to:`, buffer.path) : undefined;
    if (operation === "rename" && (!to || to === buffer.path)) return;
    if (!window.confirm(`${operation === "delete" ? "Delete" : "Rename"} the reviewed revision of ${buffer.path} in ${buffer.workspace}${to ? ` to ${to}` : ""}?`)) return;
    const result = await runFileOperation(operation, buffer.path, undefined, { workspace: buffer.workspace, cwd: buffer.cwd, confirm: true, expectedRevision: buffer.revision, ...(to ? { to } : {}) });
    if (!result) return;
    closeTab(key);
    if (to) showFile({ workspace: buffer.workspace, cwd: buffer.cwd }, to, buffer.saved, result.revision ?? buffer.revision);
    void browseWorkspace();
  }

  async function recoverStoredFiles() {
    if (selectedCapabilities?.kind !== "hosted") return;
    setFileRequests((current) => current + 1);
    try {
      const call = (operation: string, confirm = false, expectedSnapshot?: string) => fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, workspace: "hosted", confirm, expectedSnapshot }) });
      const response = await call("storage-status");
      const status = await response.json();
      if (!response.ok || !status.ok) { setFileNotice(status.error || "Stored recovery state could not be read."); return; }
      const conflicts = Array.isArray(status.conflicts) ? status.conflicts : [];
      const missing = Array.isArray(status.missing) ? status.missing : [];
      setFileNotice(`${missing.length} stored files are missing on disk. ${conflicts.length} divergent files are preserved${conflicts.length ? `: ${conflicts.slice(0, 8).join(", ")}` : "."}`);
      if (!missing.length || !window.confirm(`Restore ${missing.length} missing account files to the local hosted workspace? ${conflicts.length} divergent files will remain unchanged.`)) return;
      const restored = await call("restore-account-files", true, status.snapshot);
      const result = await restored.json();
      setFileNotice(result.ok && restored.ok ? `Restored ${result.restored.length} missing files. ${result.conflicts.length} conflicts remain preserved for review.` : result.error || "Stored recovery did not complete.");
      void browseWorkspace();
    } catch { setFileNotice("Account recovery state is unavailable. No successful restore was assumed."); }
    finally { setFileRequests((current) => current - 1); }
  }

  async function reconcileFileStorage() {
    const pending = fileReconciliation;
    if (!pending || !window.confirm(`Reconcile account storage for ${pending.action} ${pending.path}${pending.to ? ` → ${pending.to}` : ""}? Only the originally reviewed revision may change. The disk copy will not be overwritten.`)) return;
    setFileRequests((current) => current + 1);
    try {
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "reconcile", workspace: "hosted", confirm: true, ...pending }) });
      const result = await response.json();
      if (!response.ok || !result.ok) { setFileNotice(result.error || "Reconciliation failed. Both copies need review."); return; }
      setFileReconciliation(null);
      setFileNotice("The reviewed change is now reflected in account storage. Reload the file list to review its final state.");
      void browseWorkspace();
    } catch { setFileNotice("Storage reconciliation could not be verified. Inspect before retrying."); }
    finally { setFileRequests((current) => current - 1); }
  }

  async function requestTerminalApproval() {
    if (!terminalCommand.trim()) { setFileNotice("Enter a terminal command before requesting approval."); return; }
    setTerminalBusy(true);
    try {
      const response = await fetch("/api/mind/build/terminal", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: terminalCommand.trim(), agentId: selectedRuntime }) });
      const data = (await response.json()) as { ok?: boolean; hosted?: boolean; approval?: { id: string; token: string; command: string; agentId?: string; agentLabel?: string; expiresAt?: string }; error?: string };
      if (!response.ok || !data.ok || !data.approval) { setFileNotice(data.error || "Terminal approval request failed."); return; }
      setTerminalApproval({ ...data.approval, hosted: data.hosted === true, agentId: data.hosted ? "hosted" : data.approval.agentId, agentLabel: data.hosted ? "Local hosted workspace" : data.approval.agentLabel });
      setFileNotice("Terminal approval created. Review the exact command before approving.");
    } catch { setFileNotice("Terminal approval request could not reach Adrian OS."); } finally { setTerminalBusy(false); }
  }

  async function approveTerminal() {
    if (!terminalApproval) return;
    setTerminalBusy(true);
    try {
      const response = await fetch(terminalApproval.hosted ? "/api/mind/build/terminal" : "/api/mind/pc/approve", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId: terminalApproval.id, token: terminalApproval.token, command: terminalApproval.command, confirm: terminalApproval.hosted === true, agentId: terminalApproval.agentId }) });
      const data = (await response.json()) as { ok?: boolean; text?: string; error?: string };
      const text = data.text || data.error || "No terminal output returned.";
      setTerminalOutput(text);
      setTerminalHistory((prev) => [{ command: terminalApproval.command, text, ok: data.ok === true }, ...prev].slice(0, 8));
      setFileNotice(data.ok ? "Approved terminal command completed." : data.error || "Approved terminal command failed.");
      setTerminalApproval(null);
    } catch { setFileNotice("Terminal approval could not be completed."); } finally { setTerminalBusy(false); }
  }

  async function readGit(init = false) {
    setFileRequests((pending) => pending + 1);
    setFileNotice(null);
    try {
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: init ? "git-init" : "git", workspace: selectedRuntime, confirm: init }) });
      const data = (await response.json()) as GitReport & { ok?: boolean };
      setGitReport(data);
      setFileNotice(data.notice || data.error || "Git read finished. Nothing was pushed.");
    } catch {
      setFileNotice("Git status could not be read. Nothing was committed or pushed.");
    } finally {
      setFileRequests((pending) => pending - 1);
    }
  }

  async function commitGit(message: string) {
    setFileRequests((pending) => pending + 1);
    setFileNotice(null);
    try {
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "git-commit", workspace: selectedRuntime, confirm: true, content: message }) });
      const data = (await response.json()) as GitReport & { ok?: boolean };
      setGitReport(data);
      setFileNotice(data.notice || data.error || "Local commit finished. Nothing was pushed.");
    } catch {
      setFileNotice("Local commit could not be completed. Nothing was pushed.");
    } finally {
      setFileRequests((pending) => pending - 1);
    }
  }

  async function branchGit(name: string) {
    setFileRequests((pending) => pending + 1);
    setFileNotice(null);
    try {
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "git-branch", workspace: selectedRuntime, confirm: true, to: name }) });
      const data = (await response.json()) as GitReport & { ok?: boolean };
      setGitReport(data);
      setFileNotice(data.notice || data.error || "Local branch finished. Nothing was pushed.");
    } catch {
      setFileNotice("Local branch could not be created. Nothing was pushed.");
    } finally {
      setFileRequests((pending) => pending - 1);
    }
  }

  useEffect(() => {
    void refreshCompanion();
    const timer = window.setInterval(() => void refreshCompanion(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void browseWorkspace();
    const live = sessionStorage.getItem(`adrian-build-live-session.${props.ownerId || "signed-out"}`);
    if (live) setSessionId(live);
    const draft = sessionStorage.getItem(`adrian-build-draft.${props.ownerId || "signed-out"}`);
    if (!draft) return;
    setPrompt(draft);
    sessionStorage.removeItem(`adrian-build-draft.${props.ownerId || "signed-out"}`);
    const fromHuman = Boolean(sessionStorage.getItem(`adrian-human-return.${props.ownerId || "signed-out"}`));
    const requested = sessionStorage.getItem(`adrian-build-mode.${props.ownerId || "signed-out"}`);
    if (requested === "auto" || requested === "plan" || requested === "default") {
      setMode(requested);
      sessionStorage.removeItem(`adrian-build-mode.${props.ownerId || "signed-out"}`);
    }
    setNotice(fromHuman ? "Opened from Intelligence. Review the task, then press Run build. The result returns to that thread." : "Opened from Chat. Review the task, then press Run build.");
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
    try {
      const savedJobId = localStorage.getItem(`adrian-build-last-job.${props.ownerId || "signed-out"}`);
      if (savedJobId) void refreshJob(savedJobId);
    } catch { /* A new job can still run without browser storage. */ }
  }, []);

  useEffect(() => {

    void fetch("/api/mind/build/projects", { credentials: "include" }).then((response) => response.json()).then((data) => { setProjects(data.projects || []); setSessions(data.sessions || []); }).catch(() => undefined);
    void fetch("/api/mind/build/providers", { credentials: "include" }).then((response) => response.json()).then((data) => setProviders(data.providers || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!job?.id || !active) return;
    const timer = window.setInterval(() => void refreshJob(job.id), 1_500);
    return () => window.clearInterval(timer);
  }, [active, job?.id]);

  const submittingBuild = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (props.freeOnly) { setNotice("Free-only is selected. Build has no verified free coding model for this action."); return; }
    const text = prompt.trim();
    if (!text) {
      setNotice("Describe the coding task before submitting.");
      return;
    }
    if (submittingBuild.current || active) return;
    submittingBuild.current = true;
    const agentId = selectedRuntime;
    if (!selectedCapabilities?.coding) { setNotice(selectedCapabilities?.detail || "Choose a runtime with verified coding capability."); submittingBuild.current = false; return; }
    const jobKey = agentId !== "hosted" ? crypto.randomUUID().replaceAll("-", "") : undefined;
    ++pollSequence.current;
    setLoading(true);
    setNotice(null);
    setEvents([]);
    try {
      if (jobKey) {
        try { localStorage.setItem(`adrian-build-last-job.${props.ownerId || "signed-out"}`, jobKey); } catch { /* Recovery remains available on this screen. */ }
      }
      const response = await fetch("/api/mind/build/session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, agentId, jobKey, cwd: cwd.trim() || undefined, mode, resumeSessionId: sessionId || undefined }),
      });
      const data = (await response.json()) as { ok?: boolean; jobId?: string; executed?: boolean; error?: string; version?: string; agent?: string; loginRequired?: boolean; output?: string; package?: string; sessionId?: string; mode?: string; resumed?: boolean; forkedSessionId?: string; instructionReceipt?: BuilderInstructionReceipt; filesChanged?: { path: string; before: string; after: string }[] };
      setInstructionReceipt(data.instructionReceipt ?? null);
      if (!response.ok || !data.ok || !data.jobId) {
        if (data.executed) {
          if (data.sessionId) {
            setSessionId(data.sessionId);
            sessionStorage.setItem(`adrian-build-live-session.${props.ownerId || "signed-out"}`, data.sessionId);
          }
          const change = data.filesChanged?.[0];
          if (change) setLastDiff(change);
          const alive = (data as { processAlive?: boolean }).processAlive === true;
          const reused = (data as { reused?: boolean }).reused === true;
          setNotice(`${data.mode || mode} mode ran Adrian Build${reused ? " on the same running process" : data.resumed ? " and resumed the last session" : ""}. ${alive ? "The process is still running for this session." : ""} ${change ? `Changed ${change.path}.` : "No file change was reported."}`);
          const result = [change ? shortDiff(change.path, change.before, change.after) : "No file change was found on disk.", data.output].filter(Boolean).join("\n").slice(0, 2000);
          if (sessionStorage.getItem(`adrian-human-return.${props.ownerId || "signed-out"}`)) props.onResult?.(result);
          setJob({ id: "local", status: "done", output: [data.package, data.mode ? `mode ${data.mode}` : "", data.resumed ? "resumed" : "", data.forkedSessionId ? `fork ${data.forkedSessionId}` : "", data.output].filter(Boolean).join("\n") || "Accepted.", error: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          setPanel("agent");
          return;
        }
        setNotice(data.error || "The build session could not be queued.");
        return;
      }
      ++pollSequence.current;
      setJob({ id: data.jobId, status: "queued", output: "", error: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      try { localStorage.setItem(`adrian-build-last-job.${props.ownerId || "signed-out"}`, data.jobId); } catch { /* The accepted job remains visible in this session. */ }
      setNotice("Task queued on the paired computer.");
    } catch {
      setNotice("Build could not verify the outcome. Check the session history before submitting again.");
      if (jobKey) await refreshJob(jobKey);
    } finally {
      submittingBuild.current = false;
      setLoading(false);
    }
  }

  async function planWithGrok() {
    if (planFlight.current || props.halted) return;
    const owner = props.ownerId;
    if (props.freeOnly) { setNotice("Free-only is selected. Build has no verified free coding model for this action."); return; }
    const text = prompt.trim();
    if (!text) {
      setNotice("Describe the task before asking Grok for a plan.");
      return;
    }
    planFlight.current = true;
    setPlanning(true);
    setPlan("");
    setPlanModel("");
    setNotice("Asking Grok for a plan. This does not edit files.");
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(30_000);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([controller.signal, timeout]) : timeout;
    try {
      const body = chatTurnBody({
          text: `Plan this Adrian Build task. Do not claim any file was written.\n\n${text}`,
          memory: "off",
          halted: false,
          history: [],
          memoryContext: [],
          provider: "grok",
          modelTier: "Heavy",
          logicRoute: null,
          images: [],
      });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
      const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const key = `adrian.build.plan.${owner ?? "local"}.${fingerprint}`;
      let id = planAttempts.current.get(key);
      if (!id) {
        try { id = sessionStorage.getItem(key) || undefined; } catch { /* the open tab can still recover */ }
      }
      id ??= await prepareTurnId("/api/mind/turn", {}, signal);
      if (planOwner.current !== owner || signal.aborted) return;
      planAttempts.current.set(key, id);
      try { sessionStorage.setItem(key, id); } catch { /* retained in this tab */ }
      const result = await consumeMindTurn({
        url: "/api/mind/turn",
        signal,
        headers: { "content-type": "application/json", "x-mind-turn-id": id },
        body,
        onDelta: (chunk) => { if (planOwner.current === owner) setPlan((current) => current + chunk); },
      });
      if (planOwner.current !== owner) return;
      if (result.ok || !result.deliveryUncertain) {
        planAttempts.current.delete(key);
        try { sessionStorage.removeItem(key); } catch { /* browser storage unavailable */ }
      }
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
      planFlight.current = false;
      setPlanning(false);
    }
  }

  async function cancelBuild() {
    if (!job?.id || !active || job.status === "cancel_requested") return;
    try {
      const response = await fetch("/api/mind/build/cancel", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (data.ok) setJob((current) => current?.id === job.id && (current.status === "queued" || current.status === "running") ? { ...current, status: "cancel_requested" } : current);
      setNotice(data.ok ? "Cancellation requested. Waiting for the Companion to stop the runtime." : data.error || "Cancellation was not accepted.");
    } catch { setNotice("Cancellation request could not reach Adrian OS."); }
  }

  async function endCodingSession() {
    if (!sessionId) return;
    try {
      const response = await fetch("/api/mind/build/session", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close", resumeSessionId: sessionId }) });
      const data = (await response.json()) as { ok?: boolean; closed?: boolean; error?: string };
      if (!response.ok || !data.ok) { setNotice(data.error || "The coding process was not closed."); return; }
      sessionStorage.removeItem(`adrian-build-live-session.${props.ownerId || "signed-out"}`);
      setSessionId("");
      setNotice(data.closed ? "The coding process for this session was closed." : "No coding process was still running.");
    } catch {
      setNotice("The coding process could not be closed.");
    }
  }

  async function searchWorkspace(more = false) {
    const result = await runFileOperation("search", undefined, undefined, { query: searchQuery, workspace: selectedRuntime, ...(more && searchCursor ? { cursor: searchCursor } : {}) });
    if (!result) return;
    setMatchTarget({ workspace: result.workspace, cwd: result.cwd });
    setSearchMatches((current) => more ? [...new Set([...current, ...(result.matches?.map((item) => item.path) || [])])] : result.matches?.map((item) => item.path) || []);
    setSearchCursor(result.nextCursor);
    setPanel("editor");
  }

  async function restoreLatestCheckpoint() {
    if (!selectedCapabilities?.checkpoints) { setNotice(selectedCapabilities?.detail || "Checkpoint service is unavailable for this runtime."); return; }
    try {
      const listed = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "checkpoints", workspace: selectedRuntime }) });
      const data = await listed.json().catch(() => ({})) as { ok?: boolean; checkpoints?: string[]; error?: string };
      const outcome = checkpointListOutcome(listed.ok, data);
      if (!outcome.ok) { setNotice(outcome.error); return; }
      const id = outcome.latest;
      if (!id) { setNotice("No checkpoint exists in this runtime yet."); return; }
      if (!window.confirm(`Restore checkpoint ${id}? The current workspace files will be replaced.`)) return;
      const restored = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "restore", path: id, confirm: true, workspace: selectedRuntime }) });
      const result = await restored.json().catch(() => ({})) as { ok?: boolean; error?: string };
      setNotice(restored.ok && result.ok ? `Restored checkpoint ${id}. Review the files and rerun checks before claiming completion.` : result.error || "Checkpoint was not restored.");
      if (restored.ok && result.ok) void browseWorkspace();
    } catch { setNotice("Checkpoint listing could not be reached. No empty checkpoint state was assumed."); }
  }

  async function registerProject() {
    const response = await fetch("/api/mind/build/projects", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: cwd.trim() || "Workspace", cwd }) });
    const data = await response.json() as { ok?: boolean; project?: { id: string; label: string; cwd: string; instructions: string }; error?: string };
    if (data.project) setProjects((current) => [data.project!, ...current]);
    setNotice(data.ok ? "Workspace registered for this account." : data.error || "Workspace was not registered.");
  }

  async function archiveRegisteredProject(id: string) {
    const response = await fetch("/api/mind/build/projects", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive", id }) });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (data.ok) setProjects((current) => current.filter((project) => project.id !== id));
    setNotice(data.ok ? "Project archived." : data.error || "Project was not archived.");
  }

  async function renameSession(jobId: string, name: string) {
    const next = name.trim();
    if (!next) return;
    const response = await fetch("/api/mind/build/projects", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "session", jobId, name: next }) });
    const data = await response.json() as { ok?: boolean; session?: { jobId: string; name: string; archived: boolean }; error?: string };
    if (data.session) setSessions((current) => current.map((session) => session.jobId === jobId ? data.session! : session));
    setNotice(data.ok ? "Session renamed." : data.error || "Session was not renamed.");
  }

  async function submitVoice() {
    if (props.freeOnly) { setNotice("Free-only is selected. A free Build voice task route is unavailable."); return; }
    if (!transcript.trim()) return;
    if (!selectedCapabilities?.coding) { setNotice(selectedCapabilities?.detail || "Choose a runtime with coding capability."); return; }
    const instructions = projects.find((project) => project.cwd === cwd)?.instructions || "";
    const response = await fetch("/api/mind/build/voice", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, cwd, instructions, agentId: selectedRuntime }) });
    const data = await response.json() as { ok?: boolean; jobId?: string; error?: string; limitation?: string };
    if (data.jobId) {
      ++pollSequence.current;
      setJob({ id: data.jobId, status: "queued", output: "", error: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      try { localStorage.setItem(`adrian-build-last-job.${props.ownerId || "signed-out"}`, data.jobId); } catch { /* The accepted job remains visible in this session. */ }
    }
    setNotice(data.ok ? data.limitation || "Voice transcript queued." : data.error || "Voice transcript was not queued.");
  }

  async function saveProvider() {
    const response = await fetch("/api/mind/build/providers", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, apiKey }) });
    const data = await response.json() as { ok?: boolean; provider?: { id: string; label: string; model: string; hasKey: boolean; runtimeUse: string }; error?: string };
    if (data.provider) setProviders((current) => [data.provider!, ...current]);
    setApiKey("");
    setNotice(data.ok ? "Provider profile saved. The key is encrypted and stays on the server." : data.error || "Provider profile was not saved.");
  }

  function speakResult() {
    const text = assistantText || job?.output || "";
    if (!text || typeof window === "undefined" || !window.speechSynthesis) { setNotice("Speech output is not available in this browser."); return; }
   window.speechSynthesis.cancel();
    window.dispatchEvent(new Event("adrian-one-voice"));
   const utterance = new SpeechSynthesisUtterance(text.slice(0, 1_000));
    const pace = localStorage.getItem("adrian-speak-rate");
    utterance.rate = pace === "slow" ? 0.85 : pace === "brisk" ? 1.15 : 1;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className="page-shell intelligence-main" data-testid="build-workspace">
      <div className="page-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
            <div>
              <h2 className="font-display text-3xl font-bold">Adrian Build</h2>
              <p className="text-sm text-muted">Build uses its configured coding runtime. Open a workspace file to edit it, or submit a coding task.</p>
            </div>
          </div>
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => { void refreshCompanion(); if (job) void refreshJob(job.id); }}>
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <section className={`intelligence-group flex flex-wrap items-center gap-3 ${online ? "border-success/40" : "border-warning/40"}`} aria-label="Status" hidden={band !== "actions"}>
        <h3 className="w-full">Status</h3>
        {online ? <Activity className="size-5 text-success" aria-hidden="true" /> : <WifiOff className="size-5 text-warning" aria-hidden="true" />}
        <p className="min-w-0 flex-1 text-sm">{online ? (companion.detail || "Paired computer connected.") : "No paired Build agent is online. Account files are available in the editor."}</p>
        <span className="rounded-full border border-line px-2 py-1 text-xs">{online ? "Ready to queue" : "Account file editor"}</span>
      </section>

      <nav className="intelligence-group" aria-label="Build sections">
        <h3>Sections</h3>
        <div className="flex flex-wrap gap-2">
          {([
            ["actions", "Actions"],
            ["files", "Workspace"],
            ["message", "Task"],
            ["editor", "Editor"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={`min-h-11 rounded-panel border px-3 text-sm ${band === id ? "border-accent bg-accent text-accent-ink" : "border-line"}`} aria-pressed={band === id} onClick={() => setBand(id)}>{label}</button>
          ))}
        </div>
      </nav>

      <div hidden={band !== "actions"}>
      <OwnerFlow key={props.ownerId || "signed-out"}
        halted={props.halted === true}
        recording={props.recording === true}
        recordingSeconds={props.recordingSeconds ?? 0} recordingStartedAt={props.recordingStartedAt}
        onOpenSpeak={() => props.onOpenSpeak?.()}
        onToggleStop={() => props.onToggleStop?.()}
        onStopRecording={() => props.onStopRecording?.()}
      />
      </div>

      <section className="intelligence-group" aria-label="Workspace" hidden={band !== "files"}>
        <h3>Workspace</h3>
        {projects.length === 0 ? <p className="text-sm text-muted">No workspace is registered yet. Registering stores the label and path for this account. It does not prove the path is reachable.</p> : projects.map((project) => (
          <button key={project.id} type="button" className="min-h-11 rounded-panel border border-line px-3 text-left text-sm" onPointerDown={(event) => { event.currentTarget.dataset.held = "0"; const timer = window.setTimeout(() => { event.currentTarget.dataset.held = "1"; setRowMenu(project.id); }, 550); event.currentTarget.dataset.hold = String(timer); }} onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))} onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))} onClick={(event) => { if (event.currentTarget.dataset.held === "1") { event.currentTarget.dataset.held = "0"; return; } setCwd(project.cwd); setNotice(`Opened ${project.label}. File access still requires the runtime that owns this path.`); }}>
            {project.label} · {project.cwd || "no path"}
          </button>
        ))}
        {rowMenu && projects.some((project) => project.id === rowMenu) ? (
          <ActionOverlay label="Actions for workspace" title={projects.find((project) => project.id === rowMenu)?.label || "Workspace"} onClose={() => setRowMenu(null)}>
            <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { const id = rowMenu; setRowMenu(null); void archiveRegisteredProject(id); }}>Archive</button>
          </ActionOverlay>
        ) : null}
        {sessions.length === 0 ? <p className="text-sm text-muted">No saved session names yet.</p> : sessions.filter((session) => !session.archived).map((session) => (
          <button key={session.jobId} type="button" className="min-h-11 rounded-panel border border-line px-3 text-left text-sm" onPointerDown={(event) => { const timer = window.setTimeout(() => setRowMenu(`session:${session.jobId}`), 550); event.currentTarget.dataset.hold = String(timer); }} onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))} onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}>
            {session.name}
          </button>
        ))}
        {rowMenu?.startsWith("session:") ? (
          <ActionOverlay label="Actions for session" title={sessions.find((session) => session.jobId === rowMenu.slice(8))?.name || "Session"} onClose={() => setRowMenu(null)}>
            <form className="grid gap-2 p-2" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void renameSession(rowMenu.slice(8), String(data.get("name") || "")); setRowMenu(null); }}>
              <input name="name" defaultValue={sessions.find((session) => session.jobId === rowMenu.slice(8))?.name || ""} aria-label={`Rename session ${sessions.find((session) => session.jobId === rowMenu.slice(8))?.name || ""}`} className="min-h-11 rounded-panel border border-line bg-transparent px-3 text-sm" />
              <button type="submit" className="min-h-11 rounded-panel bg-accent text-sm font-semibold text-accent-ink">Save name</button>
            </form>
          </ActionOverlay>
        ) : null}
      </section>

      {workspaceFiles.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Workspace files" hidden={band !== "files"}>
          {workspaceFiles.slice(0, 8).map((file) => (
            <button key={file.path} type="button" className="min-h-11 max-w-full break-all rounded-panel border border-line px-3 text-left text-xs" onClick={() => void openFile(file.path, listingTarget)}>{file.path}</button>
          ))}
        </div>
      ) : null}
      <section className="intelligence-group" aria-label="Task" hidden={band !== "message"}>
        <h3>Task</h3>
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex items-center gap-2">
          <FolderOpen className="size-4 text-accent" aria-hidden="true" />
          <p className="font-semibold">Adrian Build</p>
        </div>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask Adrian Build to create, edit, debug, or explain code…" className="min-h-20 w-full rounded-panel border border-line bg-transparent p-3 text-sm outline-none focus:border-accent" aria-label="Coding task" />
        <details className="rounded-panel border border-line p-3">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold">Workspace and advanced controls</summary>
          <div className="mt-3 flex gap-2"><input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Optional local path, or leave blank for the hosted workspace" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Approved workspace path" /><button type="button" disabled={fileBusy} onClick={() => void browseWorkspace()} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm disabled:opacity-50"><FolderOpen className="size-4" />{fileBusy ? "Loading…" : "Browse"}</button></div>
          <div className="mt-3 flex flex-wrap gap-2">
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search approved workspace" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Workspace search" />
          <button type="button" disabled={fileBusy || !searchQuery.trim()} onClick={() => void searchWorkspace()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Search</button>
          <button type="button" disabled={!cwd.trim()} onClick={() => void registerProject()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Register workspace</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
          <input value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Dictate or paste an Adrian Speak transcript" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Voice transcript" />
          <button type="button" disabled={!transcript.trim() || !selectedCapabilities?.coding} onClick={() => void submitVoice()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Send transcript</button>
          <button type="button" onClick={speakResult} className="min-h-11 rounded-panel border border-line px-3 text-sm">Read result</button>
          <button type="button" disabled={planning || !prompt.trim()} onClick={() => void planWithGrok()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">{planning ? "Planning…" : "Plan with Grok"}</button>
          <button type="button" disabled={!prompt.trim()} onClick={() => props.onDiscuss?.(prompt)} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Discuss in Intelligence</button>
          <button type="button" onClick={() => props.onResult?.(job?.output || notice || prompt || "Build has no result yet.")} className="min-h-11 rounded-panel border border-line px-3 text-sm">Save result in Intelligence</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Grok" className="min-h-11 w-40 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Build model" />
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="Uses the saved Grok key" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Provider key" />
          <button type="button" disabled={!model.trim()} onClick={() => void saveProvider()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Save profile</button>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["plan", "Ask", "Explains only. No file is changed."],
            ["default", "Edit", "Adrian Build can change files in this workspace."],
            ["auto", "Run", "Adrian Build can change files and use tools in this workspace."],
          ] as const).map(([item, label, sentence]) => (
            <button key={item} type="button" title={sentence} onClick={() => setMode(item)} className={`min-h-11 rounded-panel border px-3 text-sm ${mode === item ? "border-accent" : "border-line"}`} aria-pressed={mode === item}>{label}</button>
          ))}
          <button type="submit" disabled={loading || Boolean(active) || !prompt.trim() || !selectedCapabilities?.coding} className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50">
            <Send className="size-4" aria-hidden="true" /> {loading ? "Queueing…" : active ? "Task running…" : mode === "plan" ? "Ask Build" : mode === "default" ? "Start edit" : "Run build"}
          </button>
          <span className="text-xs text-muted">{mode === "plan" ? "Ask explains only. No file is changed." : mode === "default" ? "Edit can change files in this workspace." : "Run can change files and use tools in this workspace."}</span>
        </div>
      </form>

      <div className="dense-card text-sm space-y-2">
        <label>Execution environment <select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={selectedRuntime} onChange={(event) => { setSelectedRuntime(event.target.value); setWorkspaceFiles([]); setListingTarget(undefined); setFileCursor(undefined); setFileTotal(0); setSearchMatches([]); setSearchCursor(undefined); }}>
          {runtimes.length ? runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.label}</option>) : <option value="hosted">Checking account capabilities…</option>}
        </select></label>
        <p className="text-muted">{selectedCapabilities?.detail || "Runtime capabilities have not loaded. Execution is unavailable until checked."}</p>
      </div>
      {notice ? <p className="dense-card text-sm" role="status">{notice}</p> : null}
      {plan ? <section className="dense-card space-y-2"><h3 className="font-semibold">Grok plan{planModel ? ` · ${planModel}` : ""}</h3><p className="text-xs text-muted">This is a reply. It did not edit a file, run a terminal, or commit.</p><pre className="whitespace-pre-wrap text-sm">{plan}</pre></section> : null}
      {fileNotice ? <p className="dense-card text-sm" role="status">{fileNotice}</p> : null}
      {fileReconciliation ? <button type="button" disabled={fileBusy} className="min-h-11 rounded-panel border border-warning/40 px-3 text-sm" onClick={() => void reconcileFileStorage()}>Review storage reconciliation for {fileReconciliation.path}</button> : null}

      {!hasWorkspaceSurface ? <div className="promo-banner text-sm"><ShieldCheck className="size-5 text-accent" aria-hidden="true" /><div><p className="font-semibold">Honest runtime boundary</p><p className="text-muted">This workspace never fabricates agent output. It shows queued, running, permission, error, and completed states from the ACP event stream.</p></div></div> : null}
      </section>
      <section className="intelligence-group" aria-label="Editor" hidden={band !== "editor"}>
        <h3>Editor</h3>
        <div className="build-panel-grid grid gap-4">
          <nav className="dense-card h-fit space-y-1" aria-label="Build panels">
            {(["agent", "timeline", "changes", "editor", "terminal", "browser", "capabilities"] as const).map((item) => (
              <button key={item} type="button" onClick={() => item === "browser" ? void openCodingBrowser() : setPanel(item)} className={`flex min-h-11 w-full items-center justify-between rounded-panel px-3 text-left text-sm ${panel === item ? "bg-accent text-accent-ink" : "text-muted hover:bg-white/5"}`}>
                <span className="flex items-center gap-2">{item === "agent" ? <Activity className="size-4" /> : item === "changes" ? <FileDiff className="size-4" /> : item === "editor" ? <Code2 className="size-4" /> : <Terminal className="size-4" />}{{ agent: "Task", timeline: "Steps", changes: "Changes", editor: "Files", terminal: "Terminal", browser: "Preview", capabilities: "Status" }[item]}</span>
                {item === "changes" && changedFiles.length ? <span>{changedFiles.length}</span> : null}
              </button>
            ))}
          </nav>
          <section className="dense-card min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xs uppercase tracking-[0.18em] text-muted">Build panel</p><h3 className="font-semibold">{panel === "agent" ? "Agent output" : panel === "timeline" ? "Execution timeline" : panel === "changes" ? "File-change review" : panel === "editor" ? "Code editor" : panel === "terminal" ? "Integrated terminal" : panel === "browser" ? "Coding browser" : "Capability inventory"}</h3></div>
              {active ? <Square className="size-4 animate-pulse text-warning" aria-label="Task active" /> : <ShieldCheck className="size-5 text-success" aria-label="Task settled" />}
            </div>
            {panel === "browser" ? <div className="space-y-2"><p className="text-sm text-muted" role="status">{browserNotice || "The coding browser uses the in-repo package and the saved Grok key. It does not ask for a separate login."}</p>{browserFrame ? <><button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => void closeCodingBrowser()}>Close coding browser</button><iframe title="Coding browser" src={browserFrame} className="h-[32rem] w-full rounded-panel border border-line bg-black" /></> : null}</div> : null}
            {panel === "agent" ? <>
              <div className="min-h-32 whitespace-pre-wrap rounded-panel border border-line bg-black/10 p-3 text-sm">{assistantText || job?.output || job?.error || "No active build task. Submit a task to stream agent output here."}</div>
              {active ? <button type="button" disabled={job?.status === "cancel_requested"} onClick={() => void cancelBuild()} className="min-h-10 rounded-panel border border-danger/40 px-3 text-sm text-danger">{job?.status === "cancel_requested" ? "Stopping…" : "Stop task"}</button> : null}
              {instructionReceipt ? <p className="text-xs text-muted break-all">Instructions attached: {instructionReceipt.id} · {instructionReceipt.version} · SHA-256 {instructionReceipt.sha256}. This receipt identifies the full instruction text sent to ACP; task results still need verification.</p> : null}
              {sessionId ? <button type="button" onClick={() => void endCodingSession()} className="min-h-10 rounded-panel border border-line px-3 text-sm">End coding session</button> : null}
              {job?.error ? <p className="text-sm text-danger" role="alert">{job.error}</p> : null}
            </> : null}
            {panel === "timeline" ? <ol className="max-h-96 space-y-2 overflow-auto text-sm">{events.map((item) => <li key={item.id} className="rounded-panel border border-line p-2"><div className="flex items-center justify-between gap-2"><span className="font-medium">{eventLabel(item)}</span><time className="text-xs text-muted">{new Date(item.createdAt).toLocaleTimeString()}</time></div>{updateText(item) ? <p className="mt-1 text-xs text-muted">{updateText(item).slice(0, 240)}</p> : null}</li>)}{!events.length ? <li className="text-sm text-muted">No events yet.</li> : null}</ol> : null}
            {panel === "changes" && selectedCapabilities?.git ? <GitReview report={gitReport} busy={fileBusy} onRead={() => void readGit(false)} onInit={() => void readGit(true)} onCommit={(message) => void commitGit(message)} onBranch={(name) => void branchGit(name)} onOpen={(path) => { setPanel("editor"); void openFile(path, { workspace: "hosted" }); }} /> : null}
            {panel === "changes" ? <div className="space-y-2">{changedFiles.map((path) => <div key={path} className="rounded-panel border border-line p-3 text-sm"><FileDiff className="mr-2 inline size-4 text-accent" />{path}<span className="ml-2 text-xs text-muted">written by ACP</span></div>)}{lastDiff ? <div className="rounded-panel border border-line p-3 text-xs"><p className="font-semibold">Reviewed save: {lastDiff.path}</p><p className="mt-2 whitespace-pre-wrap text-danger">{lastDiff.before}</p><hr className="my-2 border-line" /><p className="whitespace-pre-wrap text-success">{lastDiff.after}</p></div> : null}{!changedFiles.length && !lastDiff ? <p className="text-sm text-muted">No file-write events have been reported for this session.</p> : null}<p className="text-xs text-muted">Reviewed file saves return before/after content for bounded change review.</p></div> : null}
            {panel === "changes" ? <button type="button" disabled={!selectedCapabilities?.checkpoints} title={selectedCapabilities?.detail} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void restoreLatestCheckpoint()}>Restore last checkpoint</button> : null}
            {panel === "editor" && selectedCapabilities?.kind === "hosted" ? <button type="button" disabled={fileBusy} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void recoverStoredFiles()}>Review stored file recovery</button> : null}
            {panel === "editor" ? <CodeIde bufferSource={buffers[selectedFile] ? { ...buffers[selectedFile], text: editorText } : undefined} relatedFiles={buffers[selectedFile] ? knownCodeFilesFor(buffers[selectedFile], { target: listingTarget, files: workspaceFiles }, Object.values(buffers)) : []} onOpenRelated={openRelatedFile} canDebug={runtimes.find((runtime) => runtime.id === buffers[selectedFile]?.workspace)?.debugger === true} onRename={() => void mutateReviewedFile("rename")} onDelete={() => void mutateReviewedFile("delete")} files={workspaceFiles} matches={searchMatches} tabs={tabs.map((id) => ({ id, path: buffers[id]?.path || "", workspace: buffers[id]?.workspace || "", cwd: buffers[id]?.cwd }))} dirty={dirtyTabs} selectedId={selectedFile} selected={buffers[selectedFile]?.path || ""} text={editorText} busy={fileBusy} notice={fileNotice} newName={newFileName} onNewName={setNewFileName} onCreate={() => void createFile()} onOpen={(path) => void openFile(path, listingTarget)} onOpenMatch={(path) => void openFile(path, matchTarget)} onSelectTab={setSelectedFile} onCloseTab={closeTab} onChange={(value) => setBuffers((prev) => prev[selectedFile] ? { ...prev, [selectedFile]: { ...prev[selectedFile], draft: value } } : prev)} onCheck={() => void checkFileState()} onSave={() => void saveFile()} /> : null}
            {panel === "editor" && <div className="flex flex-wrap gap-2 text-sm"><span>{workspaceFiles.length} of {fileTotal} listed files</span>{fileCursor && <button type="button" disabled={fileBusy} className="min-h-11 text-accent" onClick={() => void browseWorkspace(true)}>Load more files</button>}{searchCursor && <button type="button" disabled={fileBusy} className="min-h-11 text-accent" onClick={() => void searchWorkspace(true)}>Load more search results</button>}</div>}
            {panel === "capabilities" ? <div className="space-y-2">{capabilities.map((item) => <div key={item.id} className="rounded-panel border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item.label}</span><span className="text-xs text-muted">{item.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-muted">{item.evidence}</p></div>)}{!capabilities.length ? <p className="text-sm text-muted">Capability inventory has not loaded.</p> : null}<div className="rounded-panel border border-line p-3 text-xs text-muted"><p>Projects: {projects.map((project) => project.label).join(", ") || "none"}</p><p>Sessions: {sessions.map((session) => session.name).join(", ") || "none"}</p><p>Providers: {providers.map((provider) => `${provider.model}${provider.hasKey ? " (key stored)" : ""} · ${provider.runtimeUse}`).join(", ") || "none"}</p></div></div> : null}
            {panel === "capabilities" ? <KimiPhase4Panel initializeResponse={null} updates={events} /> : null}
            {panel === "terminal" ? <div className="space-y-3"><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} placeholder="Command requiring explicit approval" className="min-h-11 w-full rounded-panel border border-line bg-transparent px-3 font-mono text-sm outline-none focus:border-accent" aria-label="Terminal command" /><div className="flex flex-wrap gap-2"><button type="button" disabled={terminalBusy || !terminalCommand.trim() || !selectedCapabilities?.shell} onClick={() => void requestTerminalApproval()} className="min-h-10 rounded-panel border border-line px-3 text-sm disabled:opacity-50">{terminalBusy ? "Requesting…" : "Request approval"}</button>{terminalApproval ? <button type="button" disabled={terminalBusy} onClick={() => void approveTerminal()} className="min-h-10 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50">Approve exact command</button> : null}</div>{terminalApproval ? <p className="rounded-panel border border-warning/40 bg-warning/10 p-3 text-xs">Pending approval: <code>{terminalApproval.command}</code>{terminalApproval.expiresAt ? ` · expires ${terminalApproval.expiresAt}` : ""} · {terminalApproval.agentLabel || "Reviewed computer"}</p> : null}<div className="min-h-40 whitespace-pre-wrap rounded-panel border border-line bg-black/20 p-4 font-mono text-xs text-muted">{terminalOutput || (deniedTerminals ? `${deniedTerminals} ACP terminal request${deniedTerminals === 1 ? "" : "s"} denied by the agent safety policy.` : "No approved terminal output yet.")}</div><p className="text-xs text-muted">The exact command runs only after you approve it. It remains bound to the execution environment shown on the approval. Dangerous commands are refused by the server even after approval. {terminalHistory.map((item) => `${item.ok ? "ok" : "failed"}: ${item.command}`).join(" · ")}</p></div> : null}
          </section>
        </div>
      </section>
    </section>
  );
}
