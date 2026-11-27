import { knownCodeFilesFor, reviewedRelatedNavigation, type CodeBufferSource } from "@/lib/mind/kimi/code-navigation";
import type { BuilderInstructionReceipt } from "@/lib/mind/kimi/hosted/builder-instructions";
import type { FileReconciliation } from "@/lib/mind/kimi/file-reconciliation";
import { checkpointListOutcome, type BuildRuntime } from "@/lib/mind/kimi/runtime-capabilities";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Activity, Code2, FileDiff, FolderOpen, RefreshCw, Send, ShieldCheck, Square, Terminal, WifiOff } from "lucide-react";
import { KimiPhase4Panel } from "@/components/mind/kimi-phase4-panel";
import { GitReview, type GitReport } from "@/components/mind/git-review";
import { CodeIde } from "@/components/mind/code-ide";
import { useAccountPreferences } from "@/components/mind/account-preferences-context";
import { collectAccountSkillApplications, skillReceiptSummary, type SkillApplicationReceipt } from "@/lib/mind/skill-activation";
import { BrowserEnvironments } from "@/components/mind/browser-environments";
import { OwnerFlow } from "@/components/mind/owner-flow";
import { ActionsButton, ActionOverlay } from "@/components/mind/conversation-menu";
import { getBearerToken } from "@/lib/auth/client";
import { readVoicePreferences } from "@/lib/mind/voice-preferences";
import type { ModelTier, ModelTierCatalogRow } from "@/lib/mind/model-tiers";
import type { ImageAttachment } from "@/lib/mind/media";
import { ComposerMore, MenuCluster, menuChip } from "@/components/mind/menu-material";
import { chatTurnBody } from "@/lib/mind/logic-routes";
import { consumeMindTurn, prepareTurnId } from "@/lib/mind/live-turn";
import { boundAbortSignal } from "@/lib/mind/turn-timeouts";
import { createBuildPlanningGate } from "@/lib/mind/kimi/build-lifecycle";
import { applyBuildSave, buildBufferKey as bufferKey, buildDraftKey, buildResultHandoff, matchesBuildSave, parseBuildDraft, serializeBuildDraft, type BuildEditorBuffer as EditorBuffer, type BuildFileTarget as FileTarget } from "@/lib/mind/kimi/build-review";
import { buildResultKey, parseBuildResult, serializeBuildResult, type BuildStoredReceipt } from "@/lib/mind/kimi/build-result";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

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
  sourceReceipt?: { workspace: string; cwd: string; files: { path: string; sha256: string }[]; policy: string } | null;
  id: string;
  status: "queued" | "running" | "cancel_requested" | "cancelled" | "done" | "error" | "timeout";
  output: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};
type FileResult = FileTarget & { files?: WorkspaceFile[]; matches?: { path: string }[]; path?: string; content?: string; before?: string; after?: string; truncated?: boolean; nextCursor?: string; total?: number; revision?: string };

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

type BuildWorkspaceProps = {
  planningCatalog?: ModelTierCatalogRow[];
  sharedTier?: ModelTier;
  composer?: {
    staged: { name: string; text: string } | null;
    images: ImageAttachment[];
    message: string | null;
    onFile: () => void;
    onPhoto: () => void;
    onCamera: () => void;
    onPlugins: () => void;
    removeFile: () => void;
    removeImage: (index: number) => void;
  };
  plannerRef?: { current: ((words: string, images: unknown[]) => Promise<string | undefined>) | null };
  ownerId?: string;
  enabledSkills?: Record<string, boolean>;
  freeOnly?: boolean;
  onDiscuss?: (text: string) => void;
  onResult?: (text: string) => void;
  halted?: boolean;
  recording?: boolean;
  recordingSeconds?: number;
  onOpenSpeak?: () => void;
  onToggleStop?: () => void;
  onStopRecording?: () => void;
};

export function BuildWorkspace(props: BuildWorkspaceProps = {}) {
  return <BuildWorkspaceSession key={props.ownerId || "signed-out"} {...props} />;
}

function BuildWorkspaceSession(props: BuildWorkspaceProps) {
  const preferenceStorage = useAccountPreferences();
  const [dictationEnabled, setDictationEnabled] = useState(() => readVoicePreferences(preferenceStorage).enabled);
  useEffect(() => {
    const refresh = () => setDictationEnabled(readVoicePreferences(preferenceStorage).enabled);
    refresh();
    window.addEventListener("adrian-dictation-preferences", refresh);
    return () => window.removeEventListener("adrian-dictation-preferences", refresh);
  }, [preferenceStorage]);
  const apiPrefix = typeof window === "undefined" ? "" : previewPathPrefix(window.location.hostname, window.location.pathname) || "";
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [companion, setCompanion] = useState<CompanionState>({});
  const [band, setBand] = useState<"actions" | "files" | "message" | "editor">("message");
  const [prompt, setPrompt] = useState("");
  const [incomingTask, setIncomingTask] = useState<{ text: string; threadId: string | null; mode: string | null } | null>(null);
  const taskField = useRef<HTMLTextAreaElement>(null);
  const planningController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (props.halted) planningController.current?.abort();
    return () => planningController.current?.abort();
  }, [props.halted]);
  const [cwd, setCwd] = useState("");
  const [job, setJob] = useState<BuildJob | null>(null);
  const [events, setEvents] = useState<BuildEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [plan, setPlan] = useState("");
  const [planModel, setPlanModel] = useState("");
  const [planningTier, setPlanningTier] = useState<ModelTier | null>(null);
  const planFlight = useRef(false);
  const planAttempts = useRef(new Map<string, string>());
  const planOwner = useRef(props.ownerId);
  planOwner.current = props.ownerId;
  const [planning, setPlanning] = useState(false);
  const [panel, setPanel] = useState<"agent" | "timeline" | "changes" | "editor" | "terminal" | "capabilities" | "browser">("editor");
  const [newFileName, setNewFileName] = useState("");
  const [browserFrame, setBrowserFrame] = useState("");
  const [browserNotice, setBrowserNotice] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [buffers, setBuffers] = useState<Record<string, EditorBuffer>>({});
  const [executionChoice, setExecutionChoice] = useState(false);
  const [executionReceipt, setExecutionReceipt] = useState<{ workspace: string; cwd: string; files: { path: string; sha256: string }[]; policy: string } | null>(null);
  const haltedRef = useRef(props.halted);
  haltedRef.current = props.halted;
  const buffersRef = useRef(buffers);
  const [fileRequests, setFileRequests] = useState(0);
  const fileBusy = fileRequests > 0;
  const [listingTarget, setListingTarget] = useState<FileTarget>();
  const [matchTarget, setMatchTarget] = useState<FileTarget>();
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalApproval, setTerminalApproval] = useState<{ id: string; token: string; command: string; hosted?: boolean; expiresAt?: string } | null>(null);
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
  const [buildReceipt, setBuildReceipt] = useState<BuildStoredReceipt | null>(null);
  const [sessionId, setSessionId] = useState("");

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
      const data = (await response.json()) as { ok?: boolean; job?: BuildJob; receipt?: BuildStoredReceipt | null; events?: BuildEvent[]; error?: string };
      if (!mounted.current || sequence !== pollSequence.current) return;
      if (!response.ok || !data.ok || !data.job) {
        setNotice(data.error || "Build session status could not be read.");
        return;
      }
      setJob(data.job);
      setBuildReceipt(data.receipt ?? null);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      if (!mounted.current || sequence !== pollSequence.current) return;
      setNotice("Build session status is temporarily unavailable. No completion was assumed.");
    }
  }

  async function runFileOperation(operation: "list" | "read" | "write" | "search" | "rename" | "delete", path?: string, content?: string, extra?: { query?: string; to?: string; confirm?: boolean; workspace?: string; cwd?: string; expectedMissing?: boolean; expectedContent?: string }): Promise<FileResult | null> {
    setFileRequests((pending) => pending + 1);
    setFileNotice(null);
    try {
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, cwd: cwd.trim() || undefined, path, content, ...extra }) });
      const queued = await response.json();
      if (!mounted.current) return null;
      if (response.ok && queued.ok && !queued.jobId) {
        const workspace = response.headers.get("X-Mind-Workspace");
        if (!workspace) { setFileNotice("The server did not identify the workspace. Reload after updating Mind OS."); return null; }
        return { ...(queued.result || queued), workspace };
      }
      if (!response.ok || !queued.ok || !queued.jobId) { setFileNotice(queued.error || "File operation could not be queued."); return null; }
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const statusResponse = await fetch(`/api/mind/build/files?jobId=${encodeURIComponent(queued.jobId)}`, { credentials: "include", cache: "no-store" });
        const status = (await statusResponse.json()) as { ok?: boolean; job?: { status: string; output?: string; error?: string }; error?: string };
        if (!mounted.current) return null;
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

  async function browseWorkspace() {
    const result = await runFileOperation("list");
    if (!result?.files) return;
    if (result.truncated) setFileNotice("Showing a limited file listing. Use Search for other paths.");
    setListingTarget({ workspace: result.workspace, cwd: result.cwd });
    setWorkspaceFiles(result.files);
    setPanel("editor");
  }

  async function closeCodingBrowser() {
    try {
      const response = await fetch(`${apiPrefix}/api/mind/build/browser`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Close failed");
      setBrowserFrame("");
      setBrowserNotice("Coding browser closed.");
    } catch {
      setBrowserNotice("Could not verify that the coding browser closed.");
    }
  }

  async function openCodingBrowser() {
    setPanel("browser");
    if (browserFrame) return;
    setBrowserNotice("Opening the coding browser on this computer.");
    try {
      const response = await fetch(`${apiPrefix}/api/mind/build/browser`, { method: "POST", credentials: "include" });
      const data = (await response.json()) as { ok?: boolean; frame?: string; package?: string; error?: string };
      if (!response.ok || !data.ok || !data.frame) {
        setBrowserFrame("");
        setBrowserNotice(data.error || "The coding browser did not start. No separate login was requested.");
        return;
      }
      setBrowserFrame(data.frame.startsWith("/api/") ? `${apiPrefix}${data.frame}` : data.frame);
      setBrowserNotice(`${data.package || "In-repo coding package"} is open on this computer. It is not a public page.`);
    } catch {
      setBrowserNotice("The coding browser could not be reached.");
    }
  }

  function showFile(target: FileTarget, path: string, text: string) {
    const key = bufferKey(target, path);
    setBuffers((prev) => ({ ...prev, [key]: prev[key] ?? { ...target, path, saved: text, draft: text } }));
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
    if (typeof result?.content === "string") showFile({ workspace: result.workspace, cwd: result.cwd }, path, result.content);
  }

  function openRelatedFile(path: string, source: CodeBufferSource) {
    const current = buffersRef.current[selectedFile];
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
    showFile({ workspace: result.workspace, cwd: result.cwd }, createdPath, "");
    setPanel("editor");
    setFileNotice(`Created ${createdPath}. Type in the editor, then save.`);
  }

  async function saveFile() {
    if (!selectedFile) { setFileNotice("Select a file before saving."); return; }
    const buffer = buffers[selectedFile];
    if (!buffer) return;
    if (buffer.workspace !== "hosted" && !buffer.cwd) { setFileNotice("Update the companion and reopen the file to identify its workspace root before saving."); return; }
    const result = await runFileOperation("write", buffer.path, buffer.draft, { workspace: buffer.workspace, cwd: buffer.cwd, expectedContent: buffer.saved });
    if (!mounted.current || !result) return;
    if (!matchesBuildSave(buffer, result)) { setFileNotice("The save receipt could not confirm the target and text. Check the saved file before repeating the write. Your draft was kept."); return; }
    rememberVerifiedSave(selectedFile, buffer);
    setLastDiff({ path: buffer.path, before: buffer.saved, after: buffer.draft });
    setFileNotice(`Saved ${buffer.path}. Any typing since Save remains in the draft.`);
  }

  function rememberVerifiedSave(key: string, buffer: EditorBuffer) {
    setBuffers(previous => {
      const current = previous[key];
      const saved = applyBuildSave(current, buffer);
      return saved && saved !== current ? { ...previous, [key]: saved } : previous;
    });
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
    setBuffers((prev) => prev[selectedFile] ? { ...prev, [selectedFile]: { ...prev[selectedFile], saved: disk } } : prev);
    setFileNotice(disk === buffer.draft ? "The verified disk copy matches the checked draft." : "Disk copy checked. Your draft is available for review.");
  }

  async function requestTerminalApproval() {
    if (!terminalCommand.trim()) { setFileNotice("Enter a terminal command before requesting approval."); return; }
    setTerminalBusy(true);
    try {
      const response = await fetch("/api/mind/build/terminal", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: terminalCommand.trim() }) });
      const data = (await response.json()) as { ok?: boolean; hosted?: boolean; approval?: { id: string; token: string; command: string }; error?: string };
      if (!response.ok || !data.ok || !data.approval) { setFileNotice(data.error || "Terminal approval request failed."); return; }
      setTerminalApproval({ ...data.approval, hosted: data.hosted === true });
      setFileNotice("Terminal approval created. Review the exact command before approving.");
    } catch { setFileNotice("Terminal approval request could not reach Adrian OS."); } finally { setTerminalBusy(false); }
  }

  async function approveTerminal() {
    if (!terminalApproval) return;
    setTerminalBusy(true);
    try {
      const response = await fetch(terminalApproval.hosted ? "/api/mind/build/terminal" : "/api/mind/pc/approve", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ approvalId: terminalApproval.id, token: terminalApproval.token, command: terminalApproval.command, confirm: terminalApproval.hosted === true }) });
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
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: init ? "git-init" : "git", confirm: init }) });
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
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "git-commit", confirm: true, content: message }) });
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
      const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "git-branch", confirm: true, to: name }) });
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
    const owner = props.ownerId;
    if (!owner) { setDraftHydrated(true); return; }
    try {
      const restored = parseBuildDraft(sessionStorage.getItem(buildDraftKey(owner)), owner);
      if (restored) {
        setBuffers(restored.buffers); setTabs(restored.tabs); setSelectedFile(restored.selectedFile); setPrompt(restored.prompt); setCwd(restored.cwd ?? ""); setPlanningTier(restored.planningTier ?? null);
        if (Object.values(restored.buffers).some(buffer => buffer.saved !== buffer.draft)) setFileNotice("Recovered unsaved drafts for this account. Saving will check that each original file is unchanged.");
      }
      const text = sessionStorage.getItem(`adrian-build-draft.${owner}`);
      if (text) setIncomingTask({ text, threadId: sessionStorage.getItem(`adrian-build-task-source.${owner}`), mode: sessionStorage.getItem(`adrian-build-mode.${owner}`) });
    } catch { setFileNotice("Editor draft recovery could not be read. Existing files have not been changed."); }
    setDraftHydrated(true);
  }, [props.ownerId]);

  useEffect(() => {
    if (!draftHydrated || !props.ownerId) return;
    try {
      sessionStorage.setItem(buildDraftKey(props.ownerId), serializeBuildDraft({ owner: props.ownerId, buffers, tabs, selectedFile, prompt, cwd, ...(planningTier ? { planningTier } : {}) }));
    } catch (error) { setFileNotice(error instanceof Error ? error.message : "Draft recovery could not be saved. Save or copy your changes before leaving Build."); }
  }, [buffers, tabs, selectedFile, prompt, cwd, planningTier, props.ownerId, draftHydrated]);

  useEffect(() => {
    void browseWorkspace();
    if (props.ownerId) {
      try {
        const saved = parseBuildResult(localStorage.getItem(buildResultKey(props.ownerId)), props.ownerId);
        if (saved) { setJob(saved.job); setBuildReceipt(saved.receipt); }
      } catch (error) { setNotice(error instanceof Error ? error.message : "The previous Build receipt could not be recovered. Check your saved conversation before repeating the task."); }
    }
    void fetch(`${apiPrefix}/api/mind/build/browser`, { credentials: "include", cache: "no-store" }).then(response => { if (!response.ok) throw new Error("Browser status unavailable"); return response.json(); }).then(data => {
      if (!mounted.current) return;
      if (data.running === true) { setBrowserFrame(`${apiPrefix}/api/mind/build/browser?view=frame`); setBrowserNotice("Recovered this account's running local coding browser. Website handoff permissions are separate."); }
    }).catch(() => { if (mounted.current) setBrowserNotice("Coding browser status could not be verified. Starting a session is an explicit action."); });
    const live = sessionStorage.getItem(`adrian-build-live-session.${props.ownerId || "signed-out"}`);
    if (live) setSessionId(live);
  }, []);

  function acceptIncomingTask(append: boolean) {
    if (!incomingTask || !props.ownerId) return;
    const owner = props.ownerId;
    const nextPrompt = append && prompt.trim() ? `${prompt}\n\n${incomingTask.text}` : incomingTask.text;
    try {
      const encoded = serializeBuildDraft({ owner, buffers: buffersRef.current, tabs, selectedFile, prompt: nextPrompt, cwd, ...(planningTier ? { planningTier } : {}) });
      sessionStorage.setItem(buildDraftKey(owner), encoded);
      if (sessionStorage.getItem(buildDraftKey(owner)) !== encoded) throw new Error("Build draft did not read back.");
      if (incomingTask.threadId) sessionStorage.setItem(`adrian-human-return.${owner}`, incomingTask.threadId);
      else sessionStorage.removeItem(`adrian-human-return.${owner}`);
      sessionStorage.removeItem(`adrian-build-draft.${owner}`);
      sessionStorage.removeItem(`adrian-build-task-source.${owner}`);
      sessionStorage.removeItem(`adrian-build-mode.${owner}`);
    } catch { setNotice("The handoff could not be saved. Your Build draft was kept."); return; }
    setPrompt(nextPrompt);
    if (incomingTask.mode === "auto" || incomingTask.mode === "plan" || incomingTask.mode === "default") setMode(incomingTask.mode);
    setIncomingTask(null);
    setNotice(incomingTask.threadId ? "Task added from Intelligence. Review it before running. Its result returns to the source thread." : "Task added from Chat. Review it before running.");
    taskField.current?.focus();
  }

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
    void fetch("/api/mind/build/capabilities", { credentials: "include" }).then((response) => response.json()).then((data) => { if (data.capabilities) setCapabilities(data.capabilities); }).catch(() => undefined);
    void fetch("/api/mind/build/projects", { credentials: "include" }).then((response) => response.json()).then((data) => { setProjects(data.projects || []); setSessions(data.sessions || []); }).catch(() => undefined);
    void fetch("/api/mind/build/providers", { credentials: "include" }).then((response) => response.json()).then((data) => setProviders(data.providers || [])).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!props.ownerId || !job) return;
    try { localStorage.setItem(buildResultKey(props.ownerId), serializeBuildResult({ owner: props.ownerId, job, receipt: buildReceipt })); }
    catch (error) { setNotice(error instanceof Error ? error.message : "This browser could not preserve the Build receipt. Copy or download the result before leaving Build."); }
  }, [job, buildReceipt, props.ownerId]);

  useEffect(() => {
    if (!job?.id || !active) return;
    const timer = window.setInterval(() => void refreshJob(job.id), 1_500);
    return () => window.clearInterval(timer);
  }, [active, job?.id]);

  const submittingBuild = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (editorDirty) { setExecutionChoice(true); return; }
    await runBuild("saved");
  }

  function withTaskFile(words: string) {
    const file = props.composer?.staged;
    return file ? [words.trim(), `Attached file ${file.name}:\n${file.text}`].join("\n\n") : words.trim();
  }

  async function runBuild(policy: "saved" | "save") {
    setExecutionChoice(false);
    if (haltedRef.current) { setNotice("Emergency stop is on. No Build task was started."); return; }
    if (props.freeOnly) { setNotice("Free-only is selected. Build has no verified free coding model for this action."); return; }
    if (props.composer?.images.length) { setNotice("Use Plan with Grok to review these images, then remove them before running the text-only coding task."); return; }
    const text = withTaskFile(prompt);
    if (!text) {
      setNotice("Describe the coding task before submitting.");
      return;
    }
    if (submittingBuild.current || active) return;
    submittingBuild.current = true;
    const selectedBuffer = buffersRef.current[selectedFile];
    if (!selectedBuffer && (companion.onlineAgentIds?.length ?? 0) > 1) {
      submittingBuild.current = false;
      setNotice("Open a file on the intended computer before running this task.");
      return;
    }
    const workspace = selectedBuffer?.workspace ?? companion.onlineAgentIds?.[0] ?? "hosted";
    const agentId = workspace === "hosted" ? undefined : workspace;
    const targetCwd = selectedBuffer?.cwd ?? cwd.trim();
    if (agentId && !companion.onlineAgentIds?.includes(agentId)) {
      submittingBuild.current = false;
      setNotice("The original computer is offline. Reconnect it before running this task.");
      return;
    }
    const jobKey = agentId ? crypto.randomUUID().replaceAll("-", "") : undefined;
    ++pollSequence.current;
    setLoading(true);
    setNotice(null);
    setEvents([]);
    try {
      const target = { workspace, cwd: targetCwd };
      const relevant = Object.entries(buffersRef.current).filter(([, buffer]) => buffer.workspace === target.workspace && (buffer.cwd || "") === target.cwd);
      const savedPaths: string[] = [];
      const partialSaves = () => savedPaths.length ? ` Verified saves: ${savedPaths.join(", ")}.` : "";
      if (policy === "save") {
        const unrelated = Object.values(buffersRef.current).some((buffer) => buffer.draft !== buffer.saved && (buffer.workspace !== target.workspace || (buffer.cwd || "") !== target.cwd));
        if (unrelated) { setNotice("Unsaved files belong to another workspace. Save them there, or choose Run saved version. No task started."); return; }
        for (const [key, buffer] of relevant) {
          if (buffer.draft === buffer.saved) continue;
          if (!mounted.current || haltedRef.current || planOwner.current !== props.ownerId || buffersRef.current[key]?.draft !== buffer.draft || buffersRef.current[key]?.saved !== buffer.saved) { setNotice(`The reviewed buffer or owner changed. No task started.${partialSaves()}`); return; }
          const result = await runFileOperation("write", buffer.path, buffer.draft, { workspace: buffer.workspace, cwd: buffer.cwd, expectedContent: buffer.saved });
          if (!matchesBuildSave(buffer, result)) { setNotice(`A file save could not be verified. No Build task started. Your drafts were kept.${partialSaves()}`); return; }
          savedPaths.push(buffer.path);
          rememberVerifiedSave(key, buffer);
        }
      }
      const files: { path: string; sha256: string }[] = [];
      for (const [, buffer] of relevant) {
        const content = policy === "save" ? buffer.draft : buffer.saved;
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
        files.push({ path: buffer.path, sha256: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("") });
      }
      if (!mounted.current || haltedRef.current || planOwner.current !== props.ownerId || relevant.some(([key, buffer]) => !buffersRef.current[key] || (policy === "save" && buffersRef.current[key].draft !== buffer.draft))) { setNotice(`Build stopped before submission.${partialSaves()}`); return; }
      const receipt = { ...target, files, policy };
      setExecutionReceipt(receipt);
      if (jobKey) {
        try { localStorage.setItem(`adrian-build-last-job.${props.ownerId || "signed-out"}`, jobKey); } catch { /* Recovery remains available on this screen. */ }
      }
      const response = await fetch("/api/mind/build/session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, skillApplications: collectAccountSkillApplications(preferenceStorage, text, props.enabledSkills, "build"), sourceReceipt: receipt, agentId: workspace, jobKey, cwd: targetCwd || undefined, mode, resumeSessionId: sessionId || undefined }),
      });
      const data = (await response.json()) as { ok?: boolean; jobId?: string; receipt?: BuildStoredReceipt | null; executed?: boolean; error?: string; version?: string; agent?: string; loginRequired?: boolean; output?: string; package?: string; sessionId?: string; mode?: string; resumed?: boolean; forkedSessionId?: string; filesChanged?: { path: string; before: string; after: string }[]; skillReceipts?: SkillApplicationReceipt[]; operationId?: string; outputComplete?: boolean; requestDispatched?: boolean; fileReviewScope?: string; fileReviewWarnings?: string[]; verification?: { implementation: string; builderInstructionDigest?: string; checks: { id: string; status: string }[] }; toolReceipts?: { method: string; path?: string; status: string; detail?: string; durable?: boolean }[] };
      if (!mounted.current) return;
      if (!response.ok || !data.ok || !data.jobId) {
        if (data.executed || data.toolReceipts?.length || data.filesChanged?.length) {
          const completed = data.ok === true;
          let sessionWarning = "";
          setBuildReceipt(data);
          if (data.sessionId) {
            setSessionId(data.sessionId);
            try { sessionStorage.setItem(`adrian-build-live-session.${props.ownerId || "signed-out"}`, data.sessionId); }
            catch { sessionWarning = "The session ID could not be saved for restart recovery. Download the receipt. "; }
          }
          const change = data.filesChanged?.[0];
          if (change) setLastDiff(change);
          const alive = (data as { processAlive?: boolean }).processAlive === true;
          const reused = (data as { reused?: boolean }).reused === true;
          setNotice(`${completed ? "Coding request completed; implementation verification is still pending." : `Coding request did not complete: ${data.error || "Completion was not confirmed"}. Recorded changes were preserved for review.`} ${sessionWarning}${data.outputComplete === false ? "Output exceeded the supported limit; review the incomplete receipt. " : ""}${data.mode || mode} mode ${reused ? "used the same running process" : data.resumed ? "resumed the last session" : "was requested"}. ${alive ? "The process is still running for this session." : ""} ${change ? `Recorded change: ${change.path}.` : "No file change was reported."}`);
          const result = buildResultHandoff(data.filesChanged || [], data.output || "", data.operationId, { completed, error: data.error, outputComplete: data.outputComplete });
          if (sessionStorage.getItem(`adrian-human-return.${props.ownerId || "signed-out"}`)) props.onResult?.(result);
          setJob({ id: "local", status: completed ? "done" : "error", output: [data.package, data.mode ? `mode ${data.mode}` : "", data.resumed ? "resumed" : "", data.forkedSessionId ? `fork ${data.forkedSessionId}` : "", data.output].filter(Boolean).join("\n") || "No textual output returned.", error: completed ? "" : data.error || "Coding request did not complete.", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          setPanel("agent");
          return;
        }
        setNotice(data.error || "The build session could not be queued.");
        return;
      }
      ++pollSequence.current;
      setJob({ id: data.jobId, status: "queued", output: "", error: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      setBuildReceipt(data.receipt ?? null);
      setPanel("agent");
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

  async function planWithGrok(words = prompt, images: unknown[] = props.composer?.images ?? [], github = /^\/github(?:\s|$)/i.test(words)) {
    if (planFlight.current || props.halted) return;
    const owner = props.ownerId;
    if (props.freeOnly && !github) { setNotice("Free-only is selected. Build has no verified free coding model for this action."); return; }
    const text = github ? words.trim() : withTaskFile(words);
    if (!text) {
      setNotice("Describe the task before asking Grok for a plan.");
      return;
    }
    planFlight.current = true;
    setPlanning(true);
    setPlan("");
    setPlanModel("");
    setNotice(github ? "Contacting GitHub…" : "Asking Grok for a plan.");
    const controller = new AbortController();
    planningController.current = controller;
    const timeout = AbortSignal.timeout(30_000);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([controller.signal, timeout]) : timeout;
    try {
      const body = chatTurnBody({
          text: github ? words : `Plan this Adrian Build task. Do not claim any file was written.\n\n${text}`,
          memory: "off",
          halted: false,
          history: [],
          memoryContext: [],
          provider: "grok",
          modelTier: planningTier ?? props.sharedTier ?? "Heavy",
          logicRoute: null,
          images,
      });
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
      const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const key = `adrian.build.plan.${owner ?? "local"}.${fingerprint}`;
      let id = planAttempts.current.get(key);
      if (!id) {
        try { id = sessionStorage.getItem(key) || undefined; } catch { /* the open tab can still recover */ }
      }
      const token = getBearerToken();
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      id ??= await prepareTurnId("/api/mind/turn", headers, signal);
      if (planOwner.current !== owner || signal.aborted) return;
      planAttempts.current.set(key, id);
      try { sessionStorage.setItem(key, id); } catch { /* retained in this tab */ }
      const result = await consumeMindTurn({
        url: "/api/mind/turn",
        signal,
        headers: { ...headers, "content-type": "application/json", "x-mind-turn-id": id },
        body,
        onDelta: (chunk) => { if (mounted.current && !signal.aborted && planOwner.current === owner) setPlan((current) => current + chunk); },
      });
      if (!mounted.current || signal.aborted || planOwner.current !== owner) return;
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
      setNotice(github ? "GitHub request completed." : "Grok returned a plan. No file was written.");
      return result.text;
    } catch {
      setNotice(github ? "GitHub did not confirm the request. Check the branch before retrying." : "The Grok plan could not be completed.");
    } finally {
      planFlight.current = false;
      setPlanning(false);
    }
  }

  useEffect(() => {
    const target = props.plannerRef;
    if (!target) return;
    target.current = (words, images) => planWithGrok(/^\/github(?:\s|$)/i.test(words) ? words : [prompt, words].filter(Boolean).join("\n\n"), images);
    return () => { target.current = null; };
  });

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

  async function searchWorkspace() {
    const result = await runFileOperation("search", undefined, undefined, { query: searchQuery });
    setMatchTarget(result ? { workspace: result.workspace, cwd: result.cwd } : undefined);
    setSearchMatches(result?.matches?.map((item) => item.path) || []);
    setPanel("editor");
  }

  async function restoreLatestCheckpoint() {
    const listed = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "checkpoints" }) });
    const data = await listed.json() as { ok?: boolean; checkpoints?: string[]; error?: string };
    const id = data.checkpoints?.[0];
    if (!id) { setNotice("No checkpoint yet. A checkpoint is saved before the next coding task."); return; }
    if (!window.confirm(`Restore checkpoint ${id}? The current workspace files will be replaced.`)) return;
    const restored = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "restore", path: id, confirm: true }) });
    const result = await restored.json() as { ok?: boolean; error?: string };
    setNotice(result.ok ? `Restored checkpoint ${id}.` : result.error || "Checkpoint was not restored.");
    if (result.ok) void browseWorkspace();
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
    const instructions = projects.find((project) => project.cwd === cwd)?.instructions || "";
    const response = await fetch("/api/mind/build/voice", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, cwd, instructions }) });
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
    const pace = preferenceStorage.getItem("adrian-speak-rate");
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
      <OwnerFlow
        halted={props.halted === true}
        recording={props.recording === true}
        recordingSeconds={props.recordingSeconds ?? 0}
        onOpenSpeak={() => props.onOpenSpeak?.()}
        onToggleStop={() => props.onToggleStop?.()}
        onStopRecording={() => props.onStopRecording?.()}
      />
      </div>

      <section className="intelligence-group" aria-label="Workspace" hidden={band !== "files"}>
        <h3>Workspace</h3>
        {projects.length === 0 ? <p className="text-sm text-muted">No workspace is registered yet. Registering stores the label and path for this account. It does not prove the path is reachable.</p> : projects.map((project) => (
          <div key={project.id} className="flex items-center gap-1">
            <button type="button" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line px-3 text-left text-sm" onClick={() => { setCwd(project.cwd); setNotice(`Opened ${project.label}. File access still requires the runtime that owns this path.`); }}>
              {project.label} · {project.cwd || "no path"}
            </button>
            <ActionsButton label={project.label} onOpen={() => setRowMenu(project.id)} />
          </div>
        ))}
        {rowMenu && projects.some((project) => project.id === rowMenu) ? (
          <ActionOverlay label="Actions for workspace" title={projects.find((project) => project.id === rowMenu)?.label || "Workspace"} onClose={() => setRowMenu(null)}>
            <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { const id = rowMenu; setRowMenu(null); void archiveRegisteredProject(id); }}>Archive</button>
          </ActionOverlay>
        ) : null}
        {sessions.every(session => session.archived) ? <p className="text-sm text-muted">No saved session names yet.</p> : sessions.filter((session) => !session.archived).map((session) => (
          <div key={session.jobId} className="flex items-center gap-1">
            <button type="button" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line px-3 text-left text-sm" onClick={() => setRowMenu(`session:${session.jobId}`)}>{session.name}</button>
            <ActionsButton label={session.name} onOpen={() => setRowMenu(`session:${session.jobId}`)} />
          </div>
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
      {executionChoice && <ActionOverlay label="Unsaved Build files" title="Unsaved changes" onClose={() => setExecutionChoice(false)}>
        <p>The editor contains changes not saved to the execution workspace.</p>
        <button type="button" disabled={loading || fileBusy || props.halted} onClick={() => void runBuild("save")}>Save and run</button>
        <button type="button" disabled={loading || fileBusy || props.halted} onClick={() => void runBuild("saved")}>Run saved version</button>
        <button type="button" onClick={() => setExecutionChoice(false)}>Cancel</button>
      </ActionOverlay>}
      {executionReceipt && <details className="text-xs text-muted"><summary>Submitted source receipt</summary><p>Workspace {executionReceipt.workspace} · {executionReceipt.cwd || "runtime default"} · {executionReceipt.policy === "save" ? "Verified save before submission" : "Saved versions; drafts kept"}. These hashes identify the submitted baseline; runtime readback is required to confirm which revision executed.</p><ul>{executionReceipt.files.map((file) => <li key={file.path}>{file.path} · {file.sha256}</li>)}</ul></details>}
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex items-center gap-2">
          <FolderOpen className="size-4 text-accent" aria-hidden="true" />
          <p className="font-semibold">Adrian Build</p>
        </div>
        <textarea ref={taskField} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the change you want to build…" className="min-h-24 w-full rounded-panel border border-line bg-transparent p-3 text-sm outline-none focus:border-accent" aria-label="Coding task" />
        {incomingTask && <details className="rounded-panel border border-line p-3">
          <summary className="min-h-11 cursor-pointer">Review task from {incomingTask.threadId ? "Intelligence" : "Chat"}</summary>
          <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm">{incomingTask.text}</p>
          <button type="button" disabled={active || loading} className="min-h-11 underline" onClick={() => acceptIncomingTask(Boolean(prompt.trim()))}>{prompt.trim() ? "Add to current task" : "Use this task"}</button>
        </details>}
        {props.composer && <div className="flex flex-wrap items-center gap-2" aria-label="Work attachments and project">
          <ComposerMore testId="work-composer-more-menu">
            <MenuCluster label="Add to Work">
              <button type="button" style={menuChip} onClick={props.composer.onCamera}>Camera</button>
              <button type="button" style={menuChip} onClick={props.composer.onPhoto}>Photos</button>
              <button type="button" style={menuChip} onClick={props.composer.onFile}>Files</button>
              <button type="button" style={menuChip} onClick={props.composer.onPlugins}>Plugins</button>
            </MenuCluster>
          </ComposerMore>
          <label className="flex min-h-11 flex-wrap items-center gap-2 text-sm">Choose project
            <select className="min-h-11 max-w-full rounded-panel border border-line bg-transparent px-2" aria-label="Work project" value={cwd} onChange={event => setCwd(event.target.value)}>
              <option value="">Runtime default</option>
              {cwd && !projects.some(project => project.cwd === cwd) && <option value={cwd}>{cwd}</option>}
              {projects.filter(project => project.cwd).map(project => <option key={project.id} value={project.cwd}>{project.label}</option>)}
            </select>
          </label>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={props.composer.onFile}>Files</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={props.composer.onPlugins}>Plugins</button>
          {props.composer.staged && <button type="button" className="min-h-11 px-2 text-xs" onClick={props.composer.removeFile}>Remove {props.composer.staged.name}</button>}
          {props.composer.images.map((image, index) => <button type="button" key={index} className="min-h-11 px-2 text-xs" onClick={() => props.composer?.removeImage(index)}>Remove {image.name}</button>)}
          {props.composer.message && <p className="w-full text-xs text-muted" role="status">{props.composer.message}</p>}
        </div>}
        <div className="flex flex-wrap items-center gap-2" aria-label="Build planning tools">
          {Boolean(props.planningCatalog?.length) && <label className="flex flex-wrap items-center gap-2 text-sm">Planning model
            <select aria-label="Work planning model" className="min-h-11 max-w-full rounded-panel border border-line bg-transparent px-2" value={planningTier ?? ""} onChange={event => setPlanningTier(event.target.value ? event.target.value as ModelTier : null)}>
              <option value="">Use shared tier · {props.sharedTier ?? "Heavy"}</option>
              {props.planningCatalog?.map(row => <option key={row.id} value={row.id} disabled={row.availability === "unavailable"}>{row.id}{row.model ? " · " + row.model : ""}</option>)}
            </select>
          </label>}
          <button type="button" className="min-h-11 rounded-panel border border-line px-3" title={dictationEnabled ? "Dictate into the task" : "Enable dictation in Voice settings"} disabled={props.halted || !dictationEnabled} onClick={() => { taskField.current?.focus(); window.dispatchEvent(new Event("adrian:handy-mic")); }}>Dictate task</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3" disabled={props.halted} onClick={props.onOpenSpeak}>Speak and attach images</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3" disabled={props.halted || planning || !prompt.trim()} onClick={() => void planWithGrok()}>{planning ? "Working…" : /^\/github(?:\s|$)/i.test(prompt) ? "Run GitHub request" : "Plan with Grok"}</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3" disabled={props.halted || planning} onClick={() => void planWithGrok("/github repos", [], true)}>Check GitHub repos</button>
        </div>
        {!prompt && <div className="flex flex-wrap gap-2" aria-label="Work starters">
          {[
            ["Compare local models", "Compare local AI models for this computer. Ask for any missing hardware limits."],
            ["Prepare a draft run", "Prepare a dry run for this project. List the inputs, steps and expected results before making changes."],
            ["Review my writing style", "Use the writing samples I attach to identify my style and draft a reusable style guide."],
          ].map(([label, text]) => <button key={label} type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setPrompt(text); taskField.current?.focus(); }}>{label}</button>)}
        </div>}
        <details className="rounded-panel border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Workspace and advanced controls</summary>
          <div className="mt-3 flex gap-2"><input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Optional local path, or leave blank for the hosted workspace" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Approved workspace path" /><button type="button" disabled={fileBusy} onClick={() => void browseWorkspace()} className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm disabled:opacity-50"><FolderOpen className="size-4" />{fileBusy ? "Loading…" : "Browse"}</button></div>
          <div className="mt-3 flex flex-wrap gap-2">
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search approved workspace" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Workspace search" />
          <button type="button" disabled={fileBusy || !searchQuery.trim()} onClick={() => void searchWorkspace()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Search</button>
          <button type="button" disabled={!cwd.trim()} onClick={() => void registerProject()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Register workspace</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
          <input value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Dictate or paste an Adrian Speak transcript" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm outline-none focus:border-accent" aria-label="Voice transcript" />
          <button type="button" disabled={!transcript.trim()} onClick={() => void submitVoice()} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Send transcript</button>
          <button type="button" onClick={speakResult} className="min-h-11 rounded-panel border border-line px-3 text-sm">Read result</button>
          <button type="button" disabled={!prompt.trim()} onClick={() => props.onDiscuss?.(prompt)} className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50">Discuss in Intelligence</button>
          <button type="button" onClick={() => props.onResult?.(buildResultHandoff(buildReceipt?.filesChanged?.length ? buildReceipt.filesChanged : lastDiff ? [lastDiff] : [], job?.output || notice || prompt || "Build has no result yet.", buildReceipt?.operationId, { completed: job?.status === "done", error: job?.error, outputComplete: buildReceipt?.outputComplete }))} className="min-h-11 rounded-panel border border-line px-3 text-sm">Save result in Intelligence</button>
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
            ["default", "Review", "Reviews the workspace. Writes require Run mode."],
            ["auto", "Run", "Adrian Build can change files and use tools in this workspace."],
          ] as const).map(([item, label, sentence]) => (
            <button key={item} type="button" title={sentence} onClick={() => setMode(item)} className={`min-h-11 rounded-panel border px-3 text-sm ${mode === item ? "border-accent" : "border-line"}`} aria-pressed={mode === item}>{label}</button>
          ))}
          <button type="submit" disabled={loading || Boolean(active) || !prompt.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50">
            <Send className="size-4" aria-hidden="true" /> {loading ? "Queueing…" : active ? "Task running…" : mode === "plan" ? "Ask Build" : mode === "default" ? "Review build" : "Run build"}
          </button>
          <span className="text-xs text-muted">{mode === "plan" ? "Ask explains only. No file is changed." : mode === "default" ? "Review reads the workspace. Writes require Run mode." : "Run can change files and use tools in this workspace."}</span>
        </div>
      </form>

      {notice ? <p className="dense-card text-sm" role="status">{notice}</p> : null}
      {plan ? <section className="dense-card min-w-0 space-y-2" aria-label="Build reply"><h3 className="font-semibold">Build reply{planModel ? ` · ${planModel}` : ""}</h3><div className="build-reading-result text-base">{plan}</div></section> : null}
      {fileNotice ? <p className="dense-card text-sm" role="status">{fileNotice}</p> : null}

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
            {panel === "browser" ? <div className="space-y-2"><BrowserEnvironments /><p className="text-sm text-muted" role="status">{browserNotice || "The coding browser uses the in-repo package and the saved Grok key. It does not ask for a separate login."}</p>{browserFrame ? <><button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => void closeCodingBrowser()}>Close coding browser</button><iframe title="Coding browser" src={browserFrame} className="h-[32rem] w-full rounded-panel border border-line bg-black" /></> : null}</div> : null}
            {panel === "agent" ? <>
              {buildReceipt ? <details className="rounded-panel border border-line p-3 text-sm"><summary className="cursor-pointer font-semibold">Execution receipt · implementation unverified</summary><p className="mt-2 break-all text-xs text-muted">Operation: {buildReceipt.operationId || "not supplied"}</p><p className="text-xs text-muted">Builder instruction version: {buildReceipt.verification?.builderInstructionDigest || "not reported"}</p><ul className="mt-2 space-y-1">{buildReceipt.verification?.checks.map(check => <li key={check.id}>{check.id.replaceAll("_", " ")}: {check.status.replaceAll("_", " ")}</li>)}{buildReceipt.skillReceipts?.map(receipt => <li key={receipt.skillId}>{receipt.skillId} · version {receipt.version}: {skillReceiptSummary(receipt)}</li>)}{buildReceipt.toolReceipts?.map((receipt, index) => <li key={index}>{receipt.method}{receipt.path ? ` · ${receipt.path}` : ""}: {receipt.status.replaceAll("_", " ")}{receipt.detail ? ` — ${receipt.detail}` : ""}</li>)}</ul><p className="mt-2 text-xs text-muted">{buildReceipt.fileReviewScope}</p>{buildReceipt.fileReviewWarnings?.map((warning, index) => <p key={index} className="text-xs text-warning">{warning}</p>)}<p className="mt-2 text-xs text-muted">Provider statements are not independent test evidence. Review the changed files and run the required checks before accepting the implementation.</p></details> : null}
              <div className="build-reading-result min-h-32 rounded-panel border border-line bg-black/10 p-3 text-base">{assistantText || job?.output || job?.error || "No active build task. Submit a task to stream agent output here."}</div>
              {active ? <button type="button" disabled={job?.status === "cancel_requested"} onClick={() => void cancelBuild()} className="min-h-10 rounded-panel border border-danger/40 px-3 text-sm text-danger">{job?.status === "cancel_requested" ? "Stopping…" : "Stop task"}</button> : null}
              {job?.output ? <button type="button" className="min-h-10 rounded-panel border border-line px-3 text-sm" onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify({ job, receipt: buildReceipt }, null, 2)], { type: "application/json" }));
                const link = document.createElement("a"); link.href = url; link.download = `build-${buildReceipt?.operationId || job.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}>Download full receipt</button> : null}
              {sessionId ? <button type="button" onClick={() => void endCodingSession()} className="min-h-10 rounded-panel border border-line px-3 text-sm">End coding session</button> : null}
              {job?.error ? <p className="text-sm text-danger" role="alert">{job.error}</p> : null}
            </> : null}
            {panel === "timeline" ? <ol className="max-h-96 space-y-2 overflow-auto text-sm">{events.map((item) => <li key={item.id} className="rounded-panel border border-line p-2"><div className="flex items-center justify-between gap-2"><span className="font-medium">{eventLabel(item)}</span><time className="text-xs text-muted">{new Date(item.createdAt).toLocaleTimeString()}</time></div>{updateText(item) ? <p className="mt-1 text-xs text-muted">{updateText(item).slice(0, 240)}</p> : null}</li>)}{!events.length ? <li className="text-sm text-muted">No events yet.</li> : null}</ol> : null}
            {panel === "changes" ? <GitReview report={gitReport} busy={fileBusy} onRead={() => void readGit(false)} onInit={() => void readGit(true)} onCommit={(message) => void commitGit(message)} onBranch={(name) => void branchGit(name)} onOpen={(path) => { setPanel("editor"); void openFile(path, { workspace: "hosted" }); }} /> : null}
            {panel === "changes" ? <div className="space-y-2">{changedFiles.map((path) => <div key={path} className="rounded-panel border border-line p-3 text-sm"><FileDiff className="mr-2 inline size-4 text-accent" />{path}<span className="ml-2 text-xs text-muted">written by ACP</span></div>)}{(buildReceipt?.filesChanged || []).filter(change => change.path !== lastDiff?.path).map(change => <details key={change.path} className="rounded-panel border border-line p-3 text-xs"><summary>{change.path} · verified local change</summary><p className="mt-2 whitespace-pre-wrap text-danger">{change.before}</p><hr className="my-2 border-line" /><p className="whitespace-pre-wrap text-success">{change.after}</p></details>)}{lastDiff ? <div className="rounded-panel border border-line p-3 text-xs"><p className="font-semibold">Reviewed save: {lastDiff.path}</p><p className="mt-2 whitespace-pre-wrap text-danger">{lastDiff.before}</p><hr className="my-2 border-line" /><p className="whitespace-pre-wrap text-success">{lastDiff.after}</p></div> : null}{!changedFiles.length && !lastDiff ? <p className="text-sm text-muted">No file-write events have been reported for this session.</p> : null}<p className="text-xs text-muted">Reviewed file saves return before/after content for bounded change review.</p></div> : null}
            {panel === "changes" ? <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void restoreLatestCheckpoint()}>Restore last checkpoint</button> : null}
            {panel === "editor" ? <CodeIde ownerId={props.ownerId} bufferSource={buffers[selectedFile] ? { ...buffers[selectedFile], text: editorText } : undefined} relatedFiles={buffers[selectedFile] ? knownCodeFilesFor(buffers[selectedFile], { target: listingTarget, files: workspaceFiles }, Object.values(buffers)) : []} onOpenRelated={openRelatedFile} files={workspaceFiles} matches={searchMatches} tabs={tabs.map((id) => ({ id, path: buffers[id]?.path || "", workspace: buffers[id]?.workspace || "", cwd: buffers[id]?.cwd }))} dirty={dirtyTabs} selectedId={selectedFile} selected={buffers[selectedFile]?.path || ""} text={editorText} selection={buffers[selectedFile]?.selection} onSelectionChange={(selection) => setBuffers((prev) => prev[selectedFile] && (prev[selectedFile].selection?.anchor !== selection.anchor || prev[selectedFile].selection?.head !== selection.head) ? { ...prev, [selectedFile]: { ...prev[selectedFile], selection } } : prev)} busy={fileBusy} notice={fileNotice} newName={newFileName} onNewName={setNewFileName} onCreate={() => void createFile()} onOpen={(path) => void openFile(path, listingTarget)} onOpenMatch={(path) => void openFile(path, matchTarget)} onSelectTab={setSelectedFile} onCloseTab={closeTab} onChange={(value) => setBuffers((prev) => prev[selectedFile] ? { ...prev, [selectedFile]: { ...prev[selectedFile], draft: value } } : prev)} onCheck={() => void checkFileState()} onSave={() => void saveFile()} /> : null}
            {panel === "capabilities" ? <div className="space-y-2">{capabilities.map((item) => <div key={item.id} className="rounded-panel border border-line p-3 text-sm"><div className="flex items-center justify-between gap-2"><span className="font-medium">{item.label}</span><span className="text-xs text-muted">{item.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-muted">{item.evidence}</p></div>)}{!capabilities.length ? <p className="text-sm text-muted">Capability inventory has not loaded.</p> : null}<div className="rounded-panel border border-line p-3 text-xs text-muted"><p>Projects: {projects.map((project) => project.label).join(", ") || "none"}</p><p>Sessions: {sessions.map((session) => session.name).join(", ") || "none"}</p><p>Providers: {providers.map((provider) => `${provider.model}${provider.hasKey ? " (key stored)" : ""} · ${provider.runtimeUse}`).join(", ") || "none"}</p></div></div> : null}
            {panel === "capabilities" ? <KimiPhase4Panel initializeResponse={null} updates={events} /> : null}
            {panel === "terminal" ? <div className="space-y-3"><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} placeholder="Command requiring explicit approval" className="min-h-11 w-full rounded-panel border border-line bg-transparent px-3 font-mono text-sm outline-none focus:border-accent" aria-label="Terminal command" /><div className="flex flex-wrap gap-2"><button type="button" disabled={terminalBusy || !terminalCommand.trim()} onClick={() => void requestTerminalApproval()} className="min-h-10 rounded-panel border border-line px-3 text-sm disabled:opacity-50">{terminalBusy ? "Requesting…" : "Request approval"}</button>{terminalApproval ? <button type="button" disabled={terminalBusy} onClick={() => void approveTerminal()} className="min-h-10 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50">Approve exact command</button> : null}</div>{terminalApproval ? <p className="rounded-panel border border-warning/40 bg-warning/10 p-3 text-xs">Pending approval: <code>{terminalApproval.command}</code>{terminalApproval.expiresAt ? ` · expires ${terminalApproval.expiresAt}` : ""} · hosted workspace</p> : null}<div className="min-h-40 whitespace-pre-wrap rounded-panel border border-line bg-black/20 p-4 font-mono text-xs text-muted">{terminalOutput || (deniedTerminals ? `${deniedTerminals} ACP terminal request${deniedTerminals === 1 ? "" : "s"} denied by the agent safety policy.` : "No approved terminal output yet.")}</div><p className="text-xs text-muted">The exact command runs only after you approve it. It runs in the hosted workspace when no computer is paired. Dangerous commands are refused by the server even after approval. {terminalHistory.map((item) => `${item.ok ? "ok" : "failed"}: ${item.command}`).join(" · ")}</p></div> : null}
          </section>
        </div>
      </section>
    </section>
  );
}
