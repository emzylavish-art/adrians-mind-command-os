import { useEffect, useMemo, useRef, useState, type ReactNode, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { getBearerToken } from "@/lib/auth/client";
import { SignedOut, UserButton } from "@/lib/auth/gates";
import {
  Activity,
  Bell,
  Bot,
  Database,
  FileText,
  Folder,
  Home,
  Image,
  Lock,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Square,
  Video,
  CalendarClock,
  CircleHelp,
  Link2,
  ListTree,
  Menu,
  PanelLeft,
  Pin,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";
import { approvalTokenFor, decide, type Autonomy } from "@/lib/mind/policy";
import { reaDoctor, reaInspect } from "@/lib/mind/rea";
import { CAPABILITIES, isVerifiedCapability, type CapabilityStatus } from "@/lib/mind/registry";
import { REQUIREMENTS, requirementCounts } from "@/lib/mind/requirements";
import { consumeMindTurn, shouldStoreReply } from "@/lib/mind/live-turn";
import { analyzeImageFile, createVoiceClientSecret, mcpCommand, mcpList, mcpRemove, mcpSave, mindStatus, notionCommand, notionDisconnect, notionStatus, recordAgentExecution, searchWeb, setExecutionHalt, speakText } from "@/lib/mind/server";
import { VoiceModeBadge } from "@/components/mind/voice-mode-badge";
import { VoiceLevelMeter } from "@/components/mind/voice-level-meter";
import { VoiceLiveTranscript } from "@/components/mind/voice-live-transcript";
import { VoicePicker } from "@/components/mind/voice-picker";
import { LiveVoiceBar } from "@/components/mind/live-voice-bar";
import { isLiveVoiceOccupied, LIVE_VOICE_BUSY_MESSAGE } from "@/lib/mind/voice-live/occupancy";
import { probeOllamaConductor, runOllamaConductor } from "@/lib/mind/voice/ollama-conductor";
import { formatVoiceClientError } from "@/lib/mind/voice/errors";
import { toggleVoiceMode, type VoiceRoutingMode } from "@/lib/mind/voice/mode";
import {
  getServerVoiceMode,
  getVoiceMode,
  hydrateVoiceModeStore,
  setVoiceModeStore,
  subscribeVoiceMode,
} from "@/lib/mind/voice/mode-store";
import { interruptMessageSpeak, shouldIgnoreSpeakResult } from "@/lib/mind/voice/speak-control";
import { clampSpeakText, sanitizeVoiceTranscript } from "@/lib/mind/voice/limits";
import { createListenGuard, resolveListenAction } from "@/lib/mind/voice/listen-guard";
import { formatMicCaptureError, VOICE_CONNECTION_DROPPED } from "@/lib/mind/voice/errors";
import {
  voiceMicAriaLabel,
  VOICE_TOGGLE_SHORTCUT,
} from "@/lib/mind/voice/shortcut";
import {
  createHoldToTalkController,
  shouldToggleVoiceShortcut,
} from "@/lib/mind/voice/hold-to-talk";
import { clampLiveTranscript, shouldClearLiveTranscriptOnModeSwitch } from "@/lib/mind/voice/live-transcript";
import {
  DEFAULT_XAI_VOICE,
  type XaiBuiltinVoice,
  readStoredVoiceChoice,
  writeStoredVoiceChoice,
} from "@/lib/mind/voice/voices";
import { RealtimeVoiceSession } from "@/lib/mind/voice/realtime-session";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import type { Chat, MemoryScope, Workspace } from "@/lib/mind/types";
import { ServiceBoard } from "@/components/mind/service-board";
import { FleetPanel } from "@/components/mind/fleet-panels";
import { MessageBody } from "@/components/mind/message-body";
import { haltFleet, enqueueRun, runDueSchedules, togglePin } from "@/lib/mind/fleet";
import { interpretCommand, type CommandMode } from "@/lib/mind/intent";
import { paletteHits } from "@/lib/mind/palette";
import { runLocalPlan } from "@/lib/mind/local-tools";
import { greeting } from "@/lib/mind/greeting";
import { relevantMemories } from "@/lib/mind/memory";
import { databaseMode } from "@/lib/mind/persistence";
import { runAgentTurn, type AgentTool } from "@/lib/mind/orchestrator";
import { describeFile } from "@/lib/mind/files-read";
import { extractPdfText } from "@/lib/mind/pdf-text";
import { chosenProvider, providerChoices } from "@/lib/mind/providers";
import { runSkill, searchSkills, SKILLS } from "@/lib/mind/skills";
import { exportChat, prepareRegenerate, prepareRetry, renameChat, reviseUserTurn } from "@/lib/mind/transcript";
import { useMindWorkspace } from "@/lib/mind/use-mind-workspace";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import {
  addLocalFile,
  addMemory,
  addProject,
  createChat,
  memoriesForChat,
  mergeWorkspace,
  packWorkspace,
  pushAudit,
  pushUsage,
  reviseMemory,
  unpackWorkspace,
} from "@/lib/mind/workspace";

type View =
  | "command"
  | "chat"
  | "projects"
  | "memory"
  | "agents"
  | "runs"
  | "research"
  | "files"
  | "connected"
  | "tools"
  | "build"
  | "scheduled"
  | "integrations"
  | "activity"
  | "help"
  | "skills"
  | "settings";

type Pending = {
  id: string;
  kind: string;
  label: string;
  detail: string;
  confirm: string;
  run: () => void;
};

const EXTERNAL = [
  {
    name: "Oak Bridge Capital",
    detail: "Separate product. This app does not open, edit, or store it.",
    tone: "bg-warn/15 text-warn",
    mark: "OB",
  },
  {
    name: "BridgePoint",
    detail: "Separate product. This app does not open, edit, or store it.",
    tone: "bg-info/15 text-info",
    mark: "BP",
  },
];

type Staged = { name: string; text: string };

const NAV_GROUPS: { label: string; items: { id: View; label: string; icon: typeof Home }[] }[] = [
  {
    label: "Workspace",
    items: [
      { id: "command", label: "Chat", icon: MessageSquare },
      { id: "agents", label: "Bots & Agents", icon: Bot },
      { id: "build", label: "Build", icon: Terminal },
      { id: "projects", label: "Projects", icon: Folder },
      { id: "research", label: "Research", icon: Search },
      { id: "files", label: "Library", icon: FileText },
      { id: "chat", label: "Thread", icon: MessageSquare },
      { id: "runs", label: "Runs", icon: ListTree },
    ],
  },
  {
    label: "Systems",
    items: [
      { id: "connected", label: "Connected", icon: Link2 },
      { id: "tools", label: "Tools", icon: Wrench },
      { id: "skills", label: "Skills", icon: Zap },
      { id: "scheduled", label: "Scheduled", icon: CalendarClock },
      { id: "memory", label: "Memory", icon: Database },
      { id: "activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "Personal",
    items: [
      { id: "settings", label: "Settings", icon: Settings },
      { id: "help", label: "Help", icon: CircleHelp },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

const TITLES: Record<View, string> = {
  command: "Chat",
  chat: "Thread",
  projects: "Projects",
  memory: "Memory",
  agents: "Bots & Agents",
  runs: "Runs",
  research: "Research",
  files: "Library",
  build: "Build",
  connected: "Connected",
  tools: "Tools",
  skills: "Skills",
  scheduled: "Scheduled",
  integrations: "Integrations",
  activity: "Activity",
  help: "Help",
  settings: "Settings",
};

function statusWord(status: CapabilityStatus) {
  if (status === "live_verified") return "Live verified";
  if (status === "ready") return "Ready";
  if (status === "configured") return "Configured";
  if (status === "blocked") return "Blocked";
  if (status === "unconfigured") return "Not configured";
  if (status === "local_required") return "Local only";
  if (status === "paid_required") return "Paid, not called";
  return "Not implemented";
}

function humanAction(action: string) {
  const map: Record<string, string> = {
    create_chat: "New session started",
    memory_off: "Memory turned off",
    memory_on: "Memory turned on",
    save_memory: "Note saved",
    delete_chat: "Chat deleted",
    export: "Archive exported",
    export_chat: "Chat exported",
    rename_chat: "Chat renamed",
    workspace_lookup: "Workspace lookup",
    research_refused: "Research refused",
    research_result: "Research returned sources",
    agent_plan: "Bounded agent finished",
    emergency_stop: "Emergency stop changed",
    import_merge: "Archive merged",
    import_replace: "Archive replaced",
    delete_project: "Project deleted",
    delete_memory: "Note deleted",
    delete_file: "File deleted",
    create_project: "Project created",
    archive_memory: "Note archived",
    message_sent: "Grok replied",
    rea_doctor: "REA doctor ran",
    rea_inspect: "REA inspected a file",
  };
  return map[action] ?? action;
}

function stamp(iso: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CommandApp() {
  const { ws, setWs, ready, syncNote, serverHeld, publishServerCopy } = useMindWorkspace();
  const [view, setView] = useState<View>("command");
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [commandMode, setCommandMode] = useState<CommandMode>("ask");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const turnAbort = useRef<AbortController | null>(null);
  const voiceNext = useRef(false);
  const voiceSession = useRef<RealtimeVoiceSession | null>(null);
  const listenRef = useRef<(opts?: { mode?: "toggle" | "start" | "stop" }) => void>(() => undefined);
  const voiceMode = useSyncExternalStore(subscribeVoiceMode, getVoiceMode, getServerVoiceMode);
  const voiceModeRef = useRef<VoiceRoutingMode>(voiceMode);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceLiveTranscript, setVoiceLiveTranscript] = useState("");
  const [voiceChoice, setVoiceChoice] = useState<XaiBuiltinVoice>(DEFAULT_XAI_VOICE);
  const voiceChoiceRef = useRef<XaiBuiltinVoice>(DEFAULT_XAI_VOICE);
  const listenMintAbortRef = useRef<AbortController | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const speakGenRef = useRef(0);
  const listenGuardRef = useRef(createListenGuard());
  const voiceReconnectRef = useRef(0);
  const turnGen = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [grok, setGrok] = useState("Checking");
  const [databasePill, setDatabasePill] = useState("Checking");
  const [databaseDetail, setDatabaseDetail] = useState("The status check has not finished.");
  const [grokConfigured, setGrokConfigured] = useState<boolean | null>(null);
  const [providerChoice, setProviderChoice] = useState("grok");
  const [researchCitations, setResearchCitations] = useState<{ title: string; url: string }[]>([]);
  const [agentGoal, setAgentGoal] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [agentLog, setAgentLog] = useState<{ step: number; tool: string; ok: boolean; detail: string }[]>([]);
  const agentAbort = useRef<AbortController | null>(null);
  const [system, setSystem] = useState("Checking isolation.");
  const [checkedAt, setCheckedAt] = useState("");
  const [memoryChoice, setMemoryChoice] = useState<"off" | "on">("off");
  const [autonomy, setAutonomy] = useState<Autonomy>("ask");
  const [temporary, setTemporary] = useState(false);
  const [projectChoice, setProjectChoice] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryScope, setMemoryScope] = useState<MemoryScope>("global");
  const [memoryProject, setMemoryProject] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryTab, setMemoryTab] = useState<"mine" | "project" | "transfer">("mine");
  const [researchText, setResearchText] = useState("");
  const [researchNote, setResearchNote] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [chatProjectId, setChatProjectId] = useState<string | null>(null);
  const [activityQuery, setActivityQuery] = useState("");
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [armMemory, setArmMemory] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectAbout, setProjectAbout] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [includeTemporary, setIncludeTemporary] = useState(false);
  const [importPreview, setImportPreview] = useState<{ workspace: Workspace; chats: number; memories: number; projects: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    // Single store: hydrate from localStorage once; every badge reads the same snapshot.
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    hydrateVoiceModeStore(storage);
    const choice = readStoredVoiceChoice(storage);
    voiceChoiceRef.current = choice;
    setVoiceChoice(choice);
  }, []);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "amcos.voice.choice.v1") return;
      const next = readStoredVoiceChoice(typeof localStorage === "undefined" ? null : localStorage);
      voiceChoiceRef.current = next;
      setVoiceChoice(next);
      voiceSession.current?.setVoice(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (!devices || typeof devices.addEventListener !== "function") return;
    const onDeviceChange = () => {
      const session = voiceSession.current;
      if (!session?.isCapturing) return;
      // Mic unplugged / device change while listening — stop cleanly, no stuck Listening.
      stopVoiceSession();
      setError("The microphone changed or was removed. Voice capture stopped.");
      setNotice("The microphone changed or was removed. Voice capture stopped.");
    };
    devices.addEventListener("devicechange", onDeviceChange);
    return () => devices.removeEventListener("devicechange", onDeviceChange);
  }, []);

  function applyVoiceMode(next: VoiceRoutingMode) {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const previous = voiceModeRef.current;
    const committed = setVoiceModeStore(next, storage);
    voiceModeRef.current = committed;
    if (shouldClearLiveTranscriptOnModeSwitch(previous, committed)) {
      setVoiceLiveTranscript("");
    }
  }

  function applyVoiceChoice(next: XaiBuiltinVoice) {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const committed = writeStoredVoiceChoice(next, storage);
    voiceChoiceRef.current = committed;
    setVoiceChoice(committed);
    voiceSession.current?.setVoice(committed);
  }

  function interruptSpeakPlayback() {
    interruptMessageSpeak({
      sharedAudio: sharedAudioOutput,
      abortSpeak: speakAbortRef.current,
      speechSynthesis: typeof window !== "undefined" ? window.speechSynthesis : null,
    });
    speakAbortRef.current = null;
    setSpeaking(false);
  }

  useEffect(() => {
    const releaseVoice = () => {
      interruptMessageSpeak({
        sharedAudio: sharedAudioOutput,
        abortSpeak: speakAbortRef.current,
        speechSynthesis: typeof window !== "undefined" ? window.speechSynthesis : null,
      });
      listenMintAbortRef.current?.abort();
      listenMintAbortRef.current = null;
      voiceSession.current?.close();
      voiceSession.current = null;
      setVoiceListening(false);
      setVoiceLevel(0);
      setVoiceLiveTranscript("");
      setSpeaking(false);
      listenGuardRef.current.end();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseVoice();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", releaseVoice);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", releaseVoice);
      releaseVoice();
    };
  }, []);


  const [reaBusy, setReaBusy] = useState(false);
  const [reaReport, setReaReport] = useState<string | null>(null);
  const [notion, setNotion] = useState<{ state: "unconfigured" | "disconnected" | "connected"; detail: string } | null>(null);
  const [notionQuery, setNotionQuery] = useState("");
  const [notionPages, setNotionPages] = useState<{ id: string; title: string; url: string }[]>([]);
  const [notionNote, setNotionNote] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<{ id: string; label: string; host: string; state: "unchecked" | "connected" | "failed"; tools: { name: string; description: string }[]; error: string }[]>([]);
  const [mcpLabel, setMcpLabel] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inspectNext = useRef<View | null>(null);
  const clearedStop = useRef(false);
  const counts = requirementCounts();
  const active = ws.chats.find((chat) => chat.id === activeId) ?? null;
  const storedBytes = useMemo(() => new Blob([JSON.stringify(ws)]).size, [ws]);

  useEffect(() => {
    if (!ready) return;
    mindStatus()
      .then((status) => {
        setGrokConfigured(status.grok === "configured");
        setGrok(status.grok === "configured" ? "Configured" : status.grok === "down" ? "Refused" : "Unavailable");
        const mode = databaseMode(status.databaseBackend === "postgres" || status.databaseBackend === "refused" ? status.databaseBackend : "memory");
        setDatabasePill(mode.pill);
        setDatabaseDetail(mode.detail);
        setSystem(status.database);
        setCheckedAt(status.checkedAt);
        if (status.executionHalted && !clearedStop.current) {
          setWs((prev) => (prev.halted ? prev : pushAudit({ ...prev, halted: true }, "emergency_stop", "session", "server already stopped")));
        }
      })
      .catch(() => {
        setGrok("Unavailable");
        setDatabasePill("Unknown");
        setDatabaseDetail("The status check did not finish.");
        setSystem("The status check did not finish.");
      });
    notionStatus()
      .then((status) => setNotion(status))
      .catch(() => setNotion({ state: "unconfigured", detail: "Notion status could not be read. Nothing was searched or updated." }));
    mcpList()
      .then((result) => setMcpServers(result.servers))
      .catch(() => setMcpServers([]));
    try {
      const saved = localStorage.getItem("amcos.skills.v1");
      if (saved) setEnabledSkills(JSON.parse(saved) as Record<string, boolean>);
    } catch {
      /* a private browser can refuse storage */
    }
  }, [ready, setWs]);

  useEffect(() => {
    try {
      if (localStorage.getItem("amcos.provider.v1") === "grok") setProviderChoice("grok");
    } catch {
      /* a private browser can refuse storage */
    }
  }, []);

  useEffect(() => {
    if (providerChoice !== "grok") return;
    try {
      localStorage.setItem("amcos.provider.v1", "grok");
    } catch {
      /* a private browser can refuse storage */
    }
  }, [providerChoice]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setPaletteOpen(false);
      if (shouldToggleVoiceShortcut(event, document)) {
        event.preventDefault();
        void listenRef.current({ mode: "toggle" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const hold = createHoldToTalkController({
      start: () => {
        void listenRef.current({ mode: "start" });
      },
      stop: () => {
        stopVoiceSession();
        setNotice("Voice capture stopped.");
      },
      isListening: () =>
        Boolean(
          voiceSession.current?.isOpen ||
            voiceSession.current?.isCapturing ||
            listenMintAbortRef.current,
        ),
    });
    // stopVoiceSession is stable enough via refs; hold controller owns blur/hide.
    const onDown = (event: KeyboardEvent) => hold.onKeyDown(event);
    const onUp = (event: KeyboardEvent) => hold.onKeyUp(event);
    const onBlur = () => hold.onBlurOrHide();
    const onVis = () => {
      if (document.visibilityState === "hidden") hold.onBlurOrHide();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      hold.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hold wired once; listenRef/stopVoiceSession use refs
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("amcos.theme.v1");
      if (stored === "light" || stored === "dark" || stored === "system") setTheme(stored);
    } catch {
      /* a private browser can refuse storage */
    }
  }, []);

  useEffect(() => {
    const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("amcos.theme.v1", theme);
    } catch {
      /* a private browser can refuse storage */
    }
  }, [theme]);

  const hits = useMemo(
    () =>
      paletteHits({
        query,
        projects: ws.projects,
        chats: ws.chats,
        memories: ws.memories,
        files: ws.files,
        agents: ws.agents,
        runs: ws.runs,
      }),
    [query, ws],
  );

  function closeMenus() {
    setBellOpen(false);
    setAccountOpen(false);
    setContextOpen(false);
    setToolsOpen(false);
  }

  function requestProtected(kind: string, id: string, label: string, detail: string, confirm: string, run: () => void) {
    const decision = decide({
      autonomy: active?.autonomy ?? autonomy,
      kind,
      halted: ws.halted,
      approvalToken: null,
      expectedToken: approvalTokenFor(id),
    });
    if (decision.decision === "deny") {
      setError(decision.reason);
      return;
    }
    setPending({ id, kind, label, detail, confirm, run });
  }

  function confirmPending() {
    if (!pending) return;
    const decision = decide({
      autonomy: active?.autonomy ?? autonomy,
      kind: pending.kind,
      halted: ws.halted,
      approvalToken: approvalTokenFor(pending.id),
      expectedToken: approvalTokenFor(pending.id),
    });
    if (decision.decision !== "allow") {
      setError(decision.reason);
      setPending(null);
      return;
    }
    pending.run();
    setPending(null);
  }

  function recordToolTurn(chat: Chat, text: string, reply: string, mutate?: (prev: Workspace) => Workspace, meta?: { tool: string; ok: boolean; action: "chat" | "voice" }) {
    const title = chat.messages.length > 0 ? chat.title : text.replace(/\s+/g, " ").slice(0, 48);
    const at = new Date().toISOString();
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: text, at };
    const assistant = { id: crypto.randomUUID(), role: "assistant" as const, content: reply, at, model: "local-tool" };
    setActiveId(chat.id);
    setView("chat");
    setError(null);
    if (meta) void recordAgentExecution({ data: { id: assistant.id, tool: meta.tool, action: meta.action, ok: meta.ok, detail: reply } }).catch(() => undefined);
    setWs((prev) => {
      const base = mutate ? mutate(prev) : prev;
      const exists = base.chats.some((item) => item.id === chat.id);
      const chats = exists
        ? base.chats.map((item) => (item.id === chat.id ? { ...item, title, messages: [...item.messages, userMsg, assistant] } : item))
        : [{ ...chat, title, messages: [userMsg, assistant] }, ...base.chats];
      return pushAudit({ ...base, chats }, "tool_turn", meta?.tool ?? chat.id, meta ? `${meta.action} ${meta.ok ? "completed" : "failed"}` : "no model");
    });
  }

  function agentTools(source: Workspace): AgentTool[] {
    const local = (id: "list_projects" | "list_chats" | "search_notes"): AgentTool => ({
      id,
      confirm: false,
      available: true,
      unavailableReason: "",
      run: (text) => {
        const result = runLocalPlan(source, [{ id, tool: id, query: text }], { autonomy: "automatic", halted: source.halted, tokens: {} });
        return { ok: true, text: result.lines.join("\n") || "No result." };
      },
    });
    return [
      local("list_projects"),
      local("list_chats"),
      local("search_notes"),
      {
        id: "search_skills",
        confirm: false,
        available: true,
        unavailableReason: "",
        run: (text) => {
          const matches = searchSkills(text.replace(/\bskills?\b/gi, " "));
          const usable = matches.filter((skill) => skill.kind === "built-in");
          const one = usable.length === 1 ? usable[0] : null;
          const reply = one
            ? runSkill(source, one, enabledSkills[one.id] !== false).text
            : matches.map((skill) => `${skill.name} — ${skill.kind === "built-in" ? "Built-in" : "Not installed"}. ${skill.needs}`).join("\n") || "No skill matches. Nothing was run.";
          return { ok: true, text: reply };
        },
      },
      {
        id: "list_schedules",
        confirm: false,
        available: true,
        unavailableReason: "",
        run: () => ({ ok: true, text: source.schedules.map((job) => `${job.name} · ${job.enabled ? "on" : "off"} · next ${job.nextRunAt}`).join("\n") || "No schedules." }),
      },
      {
        id: "run_due_schedules",
        confirm: true,
        available: true,
        unavailableReason: "",
        run: () => ({ ok: true, text: "Due schedules were queued on this device. No model was called." }),
      },
      {
        id: "notion",
        confirm: true,
        available: notion?.state === "connected",
        unavailableReason: "Notion is not connected. Nothing was searched.",
        run: () => ({ ok: false, text: "Notion was not called from this path." }),
      },
      {
        id: "realtime_voice",
        confirm: false,
        available: false,
        unavailableReason: "No realtime voice provider is configured. Nothing was spoken.",
        run: () => ({ ok: false, text: "" }),
      },
    ];
  }

  function settleIntent(chat: Chat, text: string, source: Workspace, action: "chat" | "voice" = "chat"): boolean {
    const intent = interpretCommand(text, source.agents, commandMode);
    if (intent.kind === "chat") return false;
    if (intent.kind === "local" || intent.kind === "skill") {
      const toolId = intent.kind === "skill" ? "search_skills" : intent.tool;
      const turn = runAgentTurn({
        userId: "local-owner",
        sessionId: chat.id,
        text,
        modality: "chat",
        tools: agentTools(source),
        toolId,
        nowMs: Date.now(),
      });
      if (turn.status === "awaiting_confirmation" && turn.confirm) {
        const grantNow = turn.confirm;
        setPending({
          id: grantNow.toolId,
          kind: "tool",
          label: "Confirm this action",
          detail: turn.text,
          confirm: "This runs only the action you just asked for.",
          run: () => {
            const again = runAgentTurn({
              userId: "local-owner",
              sessionId: chat.id,
              text,
              modality: "chat",
              tools: agentTools(source),
              toolId,
              confirm: grantNow,
              nowMs: Date.now(),
            });
            recordToolTurn(chat, text, again.text, toolId === "run_due_schedules" && again.status === "completed" ? (prev) => runDueSchedules(prev, new Date().toISOString()) : undefined, { tool: toolId, ok: again.status === "completed", action });
            setNotice("The confirmed action finished on this device. Hosted realtime is not connected.");
          },
        });
        return true;
      }
      const notes = chat.memory === "on" ? relevantMemories(source.memories, text) : [];
      const reply = notes.length ? `${turn.text}\n\nSaved note: ${notes.map((item) => item.text).join(" ")}` : turn.text;
      recordToolTurn(chat, text, reply, undefined, { tool: toolId, ok: turn.status === "completed", action });
      setNotice(turn.status === "completed" ? "The agent finished on this device. Hosted realtime is not connected." : turn.text);
      return true;
    }
    if (intent.kind === "bot") {
      const queued = enqueueRun(source, intent.agentId, intent.goal);
      recordToolTurn(
        chat,
        text,
        queued.ok
          ? `Queued ${intent.agentName}. It is not running in the background. Open Runs and press Run worker once. Nothing was sent to a model.`
          : queued.error,
        queued.ok ? () => queued.ws : undefined,
      );
      return true;
    }
    if (intent.kind === "notion") {
      void askNotion(chat, text);
      return true;
    }
    if (intent.kind === "mcp") {
      void askMcp(chat, text);
      return true;
    }
    recordToolTurn(chat, text, intent.reply);
    return true;
  }

  async function askNotion(chat: Chat, text: string, confirmed = false, pageId: string | null = null) {
    setBusy(true);
    setError(null);
    try {
      const result = await notionCommand({ data: { text, confirmed, pageId } });
      setBusy(false);
      setNotion((current) => current ?? { state: result.state, detail: result.error || "Notion answered from the server." });
      if (result.needsConfirmation && result.pages[0]) {
        const target = result.pages[0];
        setPending({
          id: target.id,
          kind: "notion-append",
          label: "Append to Notion",
          detail: result.error,
          confirm: "Append",
          run: () => {
            void askNotion(chat, text, true, target.id);
          },
        });
        return;
      }
      const lines = [result.error, ...result.pages.map((page) => `${page.title} — ${page.url}`), result.content].filter(Boolean);
      recordToolTurn(chat, text, lines.join("\n") || "Notion returned nothing.");
    } catch {
      setBusy(false);
      setError("Notion could not be reached. Nothing was changed.");
    }
  }

  async function askMcp(chat: Chat, text: string, confirmed = false) {
    setBusy(true);
    setError(null);
    try {
      const result = await mcpCommand({ data: { text, confirmed } });
      setBusy(false);
      setMcpServers(result.servers);
      if (result.needsConfirmation) {
        setPending({
          id: "mcp-call",
          kind: "mcp-call",
          label: "Call MCP tool",
          detail: result.error,
          confirm: "Call",
          run: () => {
            void askMcp(chat, text, true);
          },
        });
        return;
      }
      recordToolTurn(chat, text, [result.error, result.text].filter(Boolean).join("\n") || "MCP returned nothing.");
    } catch {
      setBusy(false);
      setError("The MCP server could not be reached. Nothing was called.");
    }
  }

  async function deliver(chat: Chat, text: string, source: Workspace, resume = false): Promise<string | null> {
    const routed = chosenProvider(providerChoice, grokConfigured);
    if (!routed.ok) {
      setError(routed.error);
      return null;
    }
    const title = resume || chat.messages.length > 0 ? chat.title : text.replace(/\s+/g, " ").slice(0, 48);
    const history = (resume ? chat.messages.slice(0, -1) : chat.messages).slice(-12);
    if (!resume) {
      const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: text, at: new Date().toISOString() };
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chat.id ? { ...item, title, messages: [...item.messages, userMsg] } : item,
        ),
      }));
    }
    setBusy(true);
    setLiveText("");
    setError(null);
    turnAbort.current?.abort();
    const generation = ++turnGen.current;
    const controller = new AbortController();
    turnAbort.current = controller;
    const timeout = AbortSignal.timeout(30_000);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([controller.signal, timeout]) : timeout;
    const token = getBearerToken();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    try {
      const result = await consumeMindTurn({
        url: `${prefix}/api/mind/turn`,
        signal,
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: {
          text,
          memory: chat.memory,
          halted: source.halted,
          history,
          memoryContext: memoriesForChat(source, chat).map((item) => ({ id: item.id, text: item.text })),
          provider: routed.id,
        },
        onDelta: (chunk) => {
          if (generation !== turnGen.current) return;
          setLiveText((current) => current + chunk);
        },
      });
      if (generation !== turnGen.current) return null;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      if (!shouldStoreReply(result)) {
        setError(result.ok ? "Grok returned an empty reply." : result.error);
        return null;
      }
      setWs((prev) => {
        const next = {
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === chat.id
              ? {
                  ...item,
                  messages: [
                    ...item.messages,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant" as const,
                      content: result.text,
                      at: new Date().toISOString(),
                      model: result.model,
                    },
                  ],
                  retrievalLog: [{ at: new Date().toISOString(), ids: result.usedIds }, ...item.retrievalLog].slice(0, 20),
                }
              : item,
          ),
        };
        return pushAudit(
          pushUsage(next, {
            id: crypto.randomUUID(),
            chatId: chat.id,
            at: new Date().toISOString(),
            model: result.model,
            requestId: result.requestId,
            promptTokens: result.usage?.prompt_tokens ?? null,
            completionTokens: result.usage?.completion_tokens ?? null,
          }),
          "message_sent",
          chat.id,
          result.model,
        );
      });
      return result.text;
    } catch (caught) {
      if (generation !== turnGen.current) return null;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      setError(caught instanceof Error && caught.message === "Unauthorized" ? "Sign in is required." : caught instanceof Error ? caught.message : "Grok could not be reached.");
      return null;
    }
  }

  function stopReply() {
    turnAbort.current?.abort();
  }

  function renameActive(title: string) {
    if (!active) return;
    const next = renameChat(ws, active.id, title);
    if (!next) {
      setError("Name the chat.");
      return;
    }
    setWs(pushAudit(next, "rename_chat", active.id, title.trim()));
    setError(null);
  }

  function editMessage(messageId: string, text: string) {
    if (!active || busy || ws.halted) return;
    const revised = reviseUserTurn(ws, active.id, messageId, text);
    if ("error" in revised) {
      setError(revised.error);
      return;
    }
    setWs(revised.ws);
    void deliver(revised.chat, revised.text, revised.ws, true);
  }

  function regenerate() {
    if (!active || busy || ws.halted) return;
    const prepared = prepareRegenerate(ws, active.id);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setWs(prepared.ws);
    void deliver(prepared.chat, prepared.text, prepared.ws, true);
  }

  function retryLast() {
    if (!active || busy || ws.halted) return;
    const prepared = prepareRetry(ws, active.id);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setError(null);
    void deliver(prepared.chat, prepared.text, ws, true);
  }

  function exportActive() {
    if (!active) return;
    const packed = exportChat(ws, active.id);
    if ("error" in packed) {
      setError(packed.error);
      return;
    }
    const blob = new Blob([packed.json], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = packed.filename;
    link.click();
    URL.revokeObjectURL(link.href);
    setWs((prev) => pushAudit(prev, "export_chat", active.id, packed.filename));
  }

  function runLookup(query: string) {
    const steps = [
      { id: "projects", tool: "list_projects" as const },
      { id: "chats", tool: "list_chats" as const },
      { id: "notes", tool: "search_notes" as const, query },
    ];
    requestProtected("lookup", "workspace-lookup", "Look through this workspace", "Lists projects and chats, then searches notes. It does not call a model or the web.", "Approve lookup", () => {
      const result = runLocalPlan(ws, steps, {
        autonomy: active?.autonomy ?? autonomy,
        halted: ws.halted,
        tokens: Object.fromEntries(steps.map((step) => [step.id, `approve:${step.id}`])),
      });
      setNotice(result.lines.join("\n"));
      setWs((prev) => pushAudit(prev, "workspace_lookup", "local", result.ok ? "finished" : "stopped"));
    });
  }

  async function sendCommand() {
    if (busy || ws.halted) return;
    const text = draft.trim();
    if (!text) {
      setError("Write what you want to work on.");
      return;
    }
    const made = createChat(ws, {
      memory: memoryChoice,
      autonomy,
      temporary,
      projectId: projectChoice || null,
    });
    const file = staged;
    const attached = file ? `\n\nAttached file ${file.name}:\n${file.text.slice(0, 6000)}` : "";
    const full = `${text}${attached}`.slice(0, 8000);
    setDraft("");
    setStaged(null);
    const source = { ...ws, chats: [made.chat, ...ws.chats] };
    if (settleIntent(made.chat, full, source)) {
      if (file) setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: projectChoice || null }));
      return;
    }
    setActiveId(made.chat.id);
    setView("chat");
    setWs((prev) => {
      let next = { ...prev, chats: [made.chat, ...prev.chats] };
      if (file) next = addLocalFile(next, { name: file.name, text: file.text, projectId: projectChoice || null });
      return pushAudit(next, "create_chat", made.chat.id, `memory ${made.chat.memory}; ${made.chat.autonomy}`);
    });
    await deliver(made.chat, full, { ...ws, chats: [made.chat, ...ws.chats] });
  }

  async function startResearch() {
    if (ws.halted) {
      setError("Emergency stop is on. No new action can run.");
      return;
    }
    setResearchCitations([]);
    try {
      const result = await searchWeb({ data: { query: researchText } });
      setError(null);
      setResearchCitations(result.citations);
      setResearchNote(result.ok ? "" : result.error);
      setWs((prev) => pushAudit(prev, result.configured && result.ok ? "research_result" : "research_refused", "search", result.ok ? `${result.citations.length} sources` : "no citation"));
    } catch (caught) {
      setResearchCitations([]);
      setResearchNote(caught instanceof Error ? caught.message : "The search did not run. No citations were created.");
    }
  }

  async function runPlanner() {
    if (ws.halted || agentBusy) return;
    const goal = agentGoal.trim();
    if (!goal) {
      setAgentNote("Write what the agent should do.");
      return;
    }
    agentAbort.current?.abort();
    const controller = new AbortController();
    agentAbort.current = controller;
    setAgentBusy(true);
    setAgentNote(null);
    setAgentLog([]);
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    const token = getBearerToken();
    try {
      const response = await fetch(`${prefix}/api/mind/agent`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          goal,
          projects: ws.projects.map((project) => project.name),
          chats: ws.chats.map((chat) => chat.title),
          notes: ws.memories.filter((note) => !note.archived).map((note) => note.text),
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; text?: string; error?: string; log?: { step: number; tool: string; ok: boolean; detail: string }[] };
      if (controller.signal.aborted) return;
      setAgentLog(payload.log ?? []);
      setAgentNote(payload.ok ? payload.text ?? "" : payload.error || "The planner did not finish.");
      setWs((prev) => pushAudit(prev, "agent_plan", "bounded", payload.ok ? "finished" : "stopped"));
    } catch {
      if (controller.signal.aborted) setAgentNote("Stopped. The unfinished reply was not saved.");
      else setAgentNote("The planner did not finish. Nothing was marked finished.");
    } finally {
      if (agentAbort.current === controller) agentAbort.current = null;
      setAgentBusy(false);
    }
  }

  async function sendInChat() {
    if (!active || busy || ws.halted) return;
    const text = draft.trim();
    if (!text && !staged) return;
    const file = staged;
    const attached = file ? `\n\nAttached file ${file.name}:\n${file.text.slice(0, 6000)}` : "";
    const full = `${text || "Read the attached file."}${attached}`.slice(0, 8000);
    setDraft("");
    setStaged(null);
    const source = ws;
    const action = voiceNext.current ? "voice" as const : "chat" as const;
    voiceNext.current = false;
    if (settleIntent(active, full, source, action)) {
      if (file) setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: active.projectId }));
      return;
    }
    if (file) {
      setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: active.projectId }));
    }
    await deliver(active, full, ws);
  }

  function enableMemory() {
    if (armMemory === "composer") {
      setMemoryChoice("on");
      setArmMemory(null);
      return;
    }
    if (!armMemory) return;
    const id = armMemory;
    setWs((prev) =>
      pushAudit(
        { ...prev, chats: prev.chats.map((chat) => (chat.id === id ? { ...chat, memory: "on" } : chat)) },
        "memory_on",
        id,
        "owner enabled retrieval",
      ),
    );
    setArmMemory(null);
  }

  function saveProject() {
    const name = projectName.trim();
    if (!name) {
      setError("Name the project.");
      return;
    }
    setWs((prev) => {
      const made = addProject(prev, name, projectAbout);
      return pushAudit(made.ws, "create_project", made.project.id, made.project.name);
    });
    setProjectName("");
    setProjectAbout("");
    setProjectOpen(false);
    setError(null);
  }

  async function onPicked(file: File) {
    if (file.size > 400_000) {
      setError("That file is too large to keep in this browser.");
      return;
    }
    if (/\.(png|jpe?g|gif|webp|heic)$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      const result = await analyzeImageFile({ data: { name: file.name, bytes: file.size, imageBase64: btoa(binary) } });
      if (result.analyzed) setNotice(`${result.provider} returned: ${result.text}`);
      else setError(result.error);
      return;
    }
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      const extracted = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
      if (!extracted.ok) {
        setError(extracted.error);
        return;
      }
      const stagedFile = { name: file.name, text: extracted.text };
      setStaged(stagedFile);
      setNotice(`Extracted ${extracted.text.length} characters from “${file.name}”. ${extracted.pages || "No"} page marker${extracted.pages === 1 ? "" : "s"} were found. This is the file text, not a model summary.`);
      return;
    }
    const text = await file.text();
    if (!text.trim() || text.includes("\u0000")) {
      setError("Only text files can be read here. Nothing was uploaded.");
      return;
    }
    const stagedFile = { name: file.name, text: text.slice(0, 40000) };
    setStaged(stagedFile);
    setError(null);
    if (inspectNext.current) {
      const destination = inspectNext.current;
      inspectNext.current = null;
      await inspectWithRea(stagedFile, destination);
      return;
    }
    setNotice(`“${file.name}” is staged on this device. Press Send to include it, or Analyze File to run REA.`);
  }

  async function downloadArchive() {
    const pack = await packWorkspace(ws, includeTemporary);
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "adrians-mind-archive.json";
    link.click();
    URL.revokeObjectURL(url);
    setWs((prev) => pushAudit(prev, "export", "workspace", pack.sha256.slice(0, 12)));
  }

  async function onImportFile(file: File) {
    setImportError(null);
    const opened = await unpackWorkspace(await file.text());
    if (!opened.ok) {
      setImportPreview(null);
      setImportError(opened.error);
      return;
    }
    setImportPreview({
      workspace: opened.workspace,
      chats: opened.counts.chats,
      memories: opened.counts.memories,
      projects: opened.counts.projects,
    });
  }

  async function toggleStop() {
    const next = !ws.halted;
    if (!next) clearedStop.current = true;
    if (next) {
      turnAbort.current?.abort();
      agentAbort.current?.abort();
    }
    setError(null);
    setWs((prev) => {
      const updated = pushAudit({ ...prev, halted: next }, "emergency_stop", "session", next ? "on" : "cleared");
      return next ? haltFleet(updated) : updated;
    });
    try {
      const result = await setExecutionHalt({ data: { on: next } });
      if (!result.ok) setError(result.error);
    } catch {
      setError(next ? "The server did not confirm the stop. Sends are blocked in this browser." : "The server did not confirm it. The stop is off in this browser.");
    }
  }
  function explain(text: string) {
    setNotice(text);
    setError(null);
  }

  function openChat() {
    const made = createChat(ws, {
      memory: memoryChoice,
      autonomy,
      temporary,
      projectId: chatProjectId || projectChoice || null,
    });
    setWs((prev) =>
      pushAudit(
        { ...prev, chats: [made.chat, ...prev.chats] },
        "create_chat",
        made.chat.id,
        `memory ${made.chat.memory}; ${made.chat.autonomy}`,
      ),
    );
    setActiveId(made.chat.id);
    setView("chat");
  }

  async function speak(text: string) {
    interruptSpeakPlayback();
    const clipped = clampSpeakText(text);
    if (!clipped) {
      setError("Nothing to read aloud.");
      return;
    }
    const generation = ++speakGenRef.current;
    const abort = new AbortController();
    speakAbortRef.current = abort;
    setSpeaking(true);
    setError(null);
    let result: Awaited<ReturnType<typeof speakText>>;
    try {
      result = await speakText({ data: { text: clipped, voiceId: voiceChoiceRef.current } });
    } catch (caught) {
      if (shouldIgnoreSpeakResult(generation, speakGenRef.current, abort.signal.aborted)) return;
      setSpeaking(false);
      setError(formatVoiceClientError(caught));
      return;
    }
    if (shouldIgnoreSpeakResult(generation, speakGenRef.current, abort.signal.aborted)) return;
    if (!result.ok) {
      if (!result.error.includes("No speech key")) {
        setSpeaking(false);
        setError(result.error);
        return;
      }
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        setSpeaking(false);
        setError(`${result.error} This browser has no speech synthesis. Nothing was spoken.`);
        return;
      }
      const utter = new SpeechSynthesisUtterance(clipped);
      utter.onend = () => {
        if (generation === speakGenRef.current) setSpeaking(false);
      };
      utter.onerror = () => {
        if (generation === speakGenRef.current) {
          setSpeaking(false);
          setError("Browser speech failed. Nothing was spoken.");
        }
      };
      synth.cancel();
      synth.speak(utter);
      setNotice("Speaking with this browser. This is not a realtime voice provider, and no speech key was used.");
      return;
    }
    try {
      await sharedAudioOutput.playMpegBase64(result.audio);
    } catch {
      if (!shouldIgnoreSpeakResult(generation, speakGenRef.current, abort.signal.aborted)) {
        setError("The browser blocked playback.");
      }
    } finally {
      if (generation === speakGenRef.current) setSpeaking(false);
    }
  }

  function appendLiveVoiceUser(text: string) {
    const clipped = text.trim();
    if (!clipped) return;
    const targetId = activeId ?? active?.id ?? null;
    if (!targetId) {
      setDraft(clipped);
      setNotice("Live voice heard you. Open a chat to keep the transcript in the thread.");
      return;
    }
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: clipped, at: new Date().toISOString() };
    setWs((prev) =>
      pushAudit(
        {
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === targetId ? { ...item, messages: [...item.messages, userMsg] } : item,
          ),
        },
        "message_sent",
        targetId,
        "live-voice-user",
      ),
    );
  }

  function appendLiveVoiceAssistant(text: string) {
    const clipped = text.trim();
    if (!clipped) return;
    const targetId = activeId ?? active?.id ?? null;
    if (!targetId) {
      setNotice(`Live voice reply: ${clipped.slice(0, 160)}`);
      return;
    }
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: clipped,
      at: new Date().toISOString(),
      model: "grok-voice-latest",
    };
    setWs((prev) =>
      pushAudit(
        {
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === targetId ? { ...item, messages: [...item.messages, assistantMsg] } : item,
          ),
        },
        "message_sent",
        targetId,
        "live-voice-assistant",
      ),
    );
  }

    function stopVoiceSession() {
    interruptSpeakPlayback();
    listenMintAbortRef.current?.abort();
    listenMintAbortRef.current = null;
    voiceSession.current?.close();
    voiceSession.current = null;
    setVoiceListening(false);
    setVoiceLevel(0);
    setVoiceLiveTranscript("");
    listenGuardRef.current.end();
  }

  async function handleVoiceTranscript(transcript: string) {
    const sanitized = sanitizeVoiceTranscript(transcript);
    if (!sanitized.ok) {
      setNotice(sanitized.error);
      return;
    }
    const text = sanitized.text;
    setDraft(text);
    voiceNext.current = true;
    setNotice(`Voice transcript ready (${voiceModeRef.current === "orchestrator" ? "Orchestrator" : "Direct"}).`);
    if (voiceModeRef.current === "orchestrator") {
      setBusy(true);
      const conducted = await runOllamaConductor(text, {
        baseUrl: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.base")) || undefined,
        model: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.model")) || undefined,
      });
      setBusy(false);
      if (!conducted.ok) {
        setError(conducted.error);
        return;
      }
      if (active) {
        const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: text, at: new Date().toISOString() };
        const assistantMsg = {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: conducted.text,
          at: new Date().toISOString(),
          model: conducted.model,
        };
        setWs((prev) =>
          pushAudit(
            {
              ...prev,
              chats: prev.chats.map((item) =>
                item.id === active.id ? { ...item, messages: [...item.messages, userMsg, assistantMsg] } : item,
              ),
            },
            "message_sent",
            active.id,
            conducted.model,
          ),
        );
      }
      if (voiceSession.current?.isOpen) voiceSession.current.speakText(conducted.text);
      else void speak(conducted.text);
      return;
    }
    if (!active) {
      setNotice("Open or create a chat so Direct mode can send the transcript to the selected model.");
      return;
    }
    if (ws.halted || busy) return;
    const reply = await deliver(active, text, ws);
    if (reply) {
      if (voiceSession.current?.isOpen) voiceSession.current.speakText(reply);
      else void speak(reply);
    }
  }

  async function listen(opts?: { mode?: "toggle" | "start" | "stop" }) {
    const mode = opts?.mode ?? "toggle";
    const active = Boolean(
      voiceListening ||
        voiceSession.current?.isOpen ||
        voiceSession.current?.isCapturing ||
        listenMintAbortRef.current,
    );
    const action = resolveListenAction(mode, active);
    if (action === "start" && isLiveVoiceOccupied()) {
      setNotice(LIVE_VOICE_BUSY_MESSAGE);
      return;
    }
    if (action === "stop") {
      stopVoiceSession();
      listenGuardRef.current.end();
      setNotice("Voice capture stopped.");
      return;
    }
    if (action === "ignore") {
      // Already listening or minting — do not toggle-stop (fixes reconnect/PTT race).
      return;
    }
    if (!listenGuardRef.current.begin()) {
      setNotice("Voice is already starting. Wait a moment.");
      return;
    }
    // Cut message-level Speak / TTS / browser speech before opening the mic.
    interruptSpeakPlayback();
    if (ws.halted) {
      listenGuardRef.current.end();
      setError("Emergency stop is on. Voice was not started.");
      return;
    }
    setError(null);
    setNotice(null);
    // Close any stale session before minting a new secret (spam / race).
    voiceSession.current?.close();
    voiceSession.current = null;

    try {
      if (voiceModeRef.current === "orchestrator") {
        const probe = await probeOllamaConductor({
          baseUrl: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.base")) || undefined,
          model: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.model")) || undefined,
        });
        if (!probe.ok) {
          setError(probe.error);
          setVoiceListening(false);
          return;
        }
      }

      listenMintAbortRef.current?.abort();
      const mintAbort = new AbortController();
      listenMintAbortRef.current = mintAbort;
      setNotice("Minting voice session… (press mic or release Space to cancel)");

      let secret: Awaited<ReturnType<typeof createVoiceClientSecret>>;
      try {
        secret = await createVoiceClientSecret();
        if (mintAbort.signal.aborted) {
          setNotice("Voice start canceled.");
          setVoiceListening(false);
          return;
        }
      } catch (caught) {
        if (mintAbort.signal.aborted) {
          setNotice("Voice start canceled.");
          setVoiceListening(false);
          return;
        }
        setError(formatVoiceClientError(caught));
        setVoiceListening(false);
        return;
      }
      if (!secret || typeof secret !== "object" || !("ok" in secret)) {
        setError(formatVoiceClientError(secret));
        setVoiceListening(false);
        return;
      }
      if (!secret.ok) {
        setError(formatVoiceClientError(secret));
        setVoiceListening(false);
        return;
      }
      if (mintAbort.signal.aborted) {
        setNotice("Voice start canceled.");
        setVoiceListening(false);
        return;
      }

      const session = new RealtimeVoiceSession(
        {
          onTranscript: (text) => {
            setVoiceLiveTranscript(clampLiveTranscript(text));
            void handleVoiceTranscript(text);
          },
          onPartialTranscript: (text) => {
            setVoiceLiveTranscript(clampLiveTranscript(text));
          },
          onSpeechStarted: () => {
            interruptSpeakPlayback();
            session.interruptPlayback();
          },
          onError: (message) => setError(message || "Voice realtime error."),
          onStatus: (status) => {
            setVoiceListening(status === "listening" || status === "processing" || status === "connecting");
            if (status === "speaking") setSpeaking(true);
            if (status === "idle" || status === "listening" || status === "closed") setSpeaking(false);
            if (status === "idle" || status === "closed") {
              setVoiceLevel(0);
              if (status === "closed") setVoiceLiveTranscript("");
            }
          },
          onLevel: (level) => setVoiceLevel(level),
          onUnexpectedClose: () => {
            listenGuardRef.current.end();
            setVoiceListening(false);
            setVoiceLevel(0);
            setVoiceLiveTranscript("");
            setSpeaking(false);
            setError(VOICE_CONNECTION_DROPPED);
            setNotice(VOICE_CONNECTION_DROPPED);
            // Optional single reconnect attempt.
            if (voiceReconnectRef.current < 1) {
              voiceReconnectRef.current += 1;
              setNotice("Voice connection dropped. Reconnecting once…");
              window.setTimeout(() => {
              void listenRef.current({ mode: "start" });
            }, 400);
            }
          },
        },
        sharedAudioOutput,
        undefined,
        { voice: voiceChoiceRef.current },
      );
      voiceSession.current = session;
      await session.connect(secret.value);
      if (mintAbort.signal.aborted) {
        session.close();
        voiceSession.current = null;
        setVoiceListening(false);
        setNotice("Voice start canceled.");
        return;
      }
      await session.startCapture();
      setVoiceListening(true);
      voiceReconnectRef.current = 0;
      listenMintAbortRef.current = null;
      setNotice(`Realtime voice listening (${voiceModeRef.current === "orchestrator" ? "Orchestrator" : "Direct"}). Hold Space or press mic to stop.`);
    } catch (caught) {
      stopVoiceSession();
      const mic = formatMicCaptureError(caught);
      setError(mic || formatVoiceClientError(caught));
    } finally {
      // Keep guard held while listening; release when idle/stop/error.
      if (!voiceSession.current?.isOpen) listenGuardRef.current.end();
    }
  }
  listenRef.current = (opts) => {
    void listen(opts);
  };

  async function checkRea() {
    setReaBusy(true);
    setError(null);
    const result = await reaDoctor();
    setReaBusy(false);
    if (!result.ok) {
      setReaReport(result.error);
      setWs((prev) => pushAudit(prev, "rea_doctor", "rea", "failed"));
      return;
    }
    const gaps = result.gaps.map((gap) => `${gap.name}: ${gap.detail}`).join("\n");
    setReaReport(
      `REA ${result.version} (${result.package}). Exit ${result.exitCode}. Healthy: ${result.healthy ? "yes" : "no"}.\n${gaps || "No gaps reported."}`,
    );
    setWs((prev) => pushAudit(prev, "rea_doctor", "rea", result.healthy ? "healthy" : "not healthy"));
  }

  async function inspectWithRea(file: { name: string; text: string }, destination: View = "research") {
    setReaBusy(true);
    setView(destination);
    setError(null);
    const result = await reaInspect({ data: file });
    setReaBusy(false);
    if (!result.ok) {
      setReaReport(result.error);
      setWs((prev) => pushAudit(prev, "rea_inspect", file.name, "failed"));
      return;
    }
    setReaReport(
      `${result.provider} ran ${result.operation} on a ${result.format}.\nEvidence ${result.evidenceId ?? "not returned"}.\nSHA-256 ${result.sha256 ?? "not returned"}.\nSource ${result.source}.`,
    );
    setWs((prev) => pushAudit(prev, "rea_inspect", file.name, result.evidenceId ?? "no evidence id"));
  }

  const headerState = ws.halted ? "Stopped" : grok === "Configured" ? "Grok configured" : grok;
  const headerTone = ws.halted || grok === "Refused" || grok === "Unavailable" ? "text-danger border-danger/40" : "text-muted border-line";
  const memories = ws.memories.filter((item) => {
    if (!showArchived && item.archived) return false;
    if (memoryTab === "mine" && item.scope !== "global") return false;
    if (memoryTab === "project" && item.scope !== "project") return false;
    if (memoryTab === "project" && memoryProject && item.projectId !== memoryProject) return false;
    return item.text.toLowerCase().includes(memoryQuery.trim().toLowerCase());
  });
  const memoryBytes = ws.memories.reduce((sum, item) => sum + item.text.length, 0);

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg md:flex-row">
      <aside className={`${navOpen ? "flex" : "hidden"} fixed inset-0 z-40 w-full flex-col bg-surface md:static md:flex md:h-dvh ${railCollapsed ? "md:w-16" : "md:w-64"} md:shrink-0 md:border-r md:border-line`}>
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-info to-accent text-lg font-bold text-white shadow-[0_0_18px_rgb(124_92_255/0.55)]">
            A
          </span>
          {!railCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold tracking-wide">ADRIAN'S MIND</p>
              <p className="text-[10px] tracking-[0.22em] text-muted">COMMAND OS</p>
            </div>
          )}
          <button type="button" className="grid size-11 place-items-center rounded-panel border border-line md:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)}>
            <span className="text-lg">×</span>
          </button>
          <button type="button" className="hidden size-11 place-items-center rounded-panel border border-line md:grid" aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setRailCollapsed((value) => !value)}>
            <PanelLeft className="size-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-auto px-3 pb-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              {!railCollapsed && <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-muted">{group.label.toUpperCase()}</p>}
              {group.items.map((item) => {
                const Icon = item.icon;
                const on = view === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onClick={() => {
                      setView(item.id);
                      setNavOpen(false);
                      closeMenus();
                    }}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium ${on ? "bg-accent text-white shadow-[0_0_18px_rgb(124_92_255/0.45)]" : "text-muted"}`}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!railCollapsed && item.label}
                  </button>
                );
              })}
            </div>
          ))}
          {ws.pins.length > 0 && !railCollapsed && (
            <div className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-muted">PINNED</p>
              {ws.pins.map((pin) => {
                const label =
                  pin.kind === "agent"
                    ? ws.agents.find((agent) => agent.id === pin.ref)?.name
                    : pin.kind === "chat"
                      ? ws.chats.find((chat) => chat.id === pin.ref)?.title
                      : pin.kind === "project"
                        ? ws.projects.find((project) => project.id === pin.ref)?.name
                        : ws.files.find((file) => file.id === pin.ref)?.name;
                if (!label) return null;
                return (
                  <button
                    key={pin.id}
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 rounded-2xl px-3 text-left text-sm text-muted"
                    onClick={() => {
                      if (pin.kind === "chat") {
                        setActiveId(pin.ref);
                        setView("chat");
                      } else if (pin.kind === "agent") setView("agents");
                      else if (pin.kind === "project") setView("projects");
                      else setView("files");
                      setNavOpen(false);
                    }}
                  >
                    <Pin className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {ws.chats.length > 0 && !railCollapsed && (
            <div className="mb-3">
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.18em] text-muted">RECENT</p>
              {ws.chats.slice(0, 5).map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm text-muted"
                  onClick={() => {
                    setActiveId(chat.id);
                    setView("chat");
                    setNavOpen(false);
                  }}
                >
                  <span className="truncate">{chat.title}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        {!railCollapsed && (
          <div className="border-t border-line p-4">
            <p className="text-sm font-semibold">Adrian (Personal)</p>
            <p className="text-xs text-muted">Only workspace on this device.</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (storedBytes / 5_000_000) * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">Storage · {formatBytes(storedBytes)} in this browser</p>
            <p className="text-xs text-muted">Not a cloud quota. Pins stay in this browser copy.</p>
          </div>
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-36 md:pb-36">
        <header className="flex items-center gap-2 border-b border-line px-3 py-3 md:gap-3 md:px-5">
          <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel border border-line md:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Menu className="size-4" />
          </button>
          <p className="hidden text-sm font-semibold md:block">{TITLES[view]}</p>
          <div className="hidden shrink-0 md:block">
            <div className="flex items-center gap-2">
              <VoiceLevelMeter level={voiceLevel} listening={voiceListening} />
              <VoiceModeBadge
                mode={voiceMode}
                listening={voiceListening}
                onToggle={() => applyVoiceMode(toggleVoiceMode(voiceMode))}
              />
              <VoiceLiveTranscript text={voiceLiveTranscript} />
              <VoicePicker value={voiceChoice} onChange={applyVoiceChoice} disabled={voiceListening} />
            </div>
          </div>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPaletteOpen(true);
              }}
              onFocus={() => setPaletteOpen(true)}
              placeholder="Search or jump…"
              className="h-11 w-full rounded-panel border border-line bg-surface pr-14 pl-10 text-sm"
              aria-label="Search"
              aria-keyshortcuts="Control+K Meta+K"
              aria-expanded={paletteOpen}
              aria-controls="command-palette"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">⌘K</span>
            {paletteOpen && (
              <div id="command-palette" className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-panel border border-line bg-surface p-2 shadow-panel">
                {hits.length === 0 && <p className="px-2 py-2 text-sm text-muted">No matches.</p>}
                {hits.map((hit) => {
                  const kind = hit.meta === "Chat" ? "chat" : hit.meta === "Agent" ? "agent" : hit.meta === "Project" ? "project" : hit.meta === "File" ? "file" : null;
                  return (
                    <div key={hit.key} className="flex items-center gap-1">
                      <button
                        type="button"
                        className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-panel px-2 text-left text-sm"
                        onClick={() => {
                          if (hit.view === "chat" && hit.ref) setActiveId(hit.ref);
                          setView(hit.view);
                          setQuery("");
                          setPaletteOpen(false);
                          setNavOpen(false);
                        }}
                      >
                        <span className="truncate">{hit.label}</span>
                        <span className="text-xs text-muted">{hit.meta}</span>
                      </button>
                      {kind && hit.ref && (
                        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel text-muted" aria-label={`Pin ${hit.label}`} onClick={() => setWs((prev) => togglePin(prev, kind, hit.ref))}>
                          <Pin className="size-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <span className={`hidden h-11 items-center gap-2 rounded-full border px-3 text-sm md:inline-flex ${headerTone}`}>
            <span className="size-2 rounded-full bg-current" />
            {headerState}
          </span>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full border border-line"
            aria-label="Alerts"
            onClick={() => {
              setBellOpen((open) => !open);
              setAccountOpen(false);
            }}
          >
            <Bell className="size-4" />
          </button>
          <button
            type="button"
            className="flex h-11 items-center gap-2 rounded-full border border-line px-2"
            onClick={() => {
              setAccountOpen((open) => !open);
              setBellOpen(false);
            }}
          >
            <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-bold text-accent-ink">A</span>
            <span className="hidden text-sm md:inline">Adrian</span>
          </button>
        </header>
        {bellOpen && (
          <div className="border-b border-line bg-surface px-4 py-3 text-sm">
            <p className="font-semibold">Alerts</p>
            {ws.halted && <p className="mt-1 text-danger">Emergency stop is on. Sending and approvals are blocked.</p>}
            {ws.audit.length === 0 && !ws.halted && <p className="mt-1 text-muted">No alerts.</p>}
            {ws.audit.slice(0, 4).map((entry) => (
              <p key={entry.id} className="mt-1 text-muted">
                {humanAction(entry.action)} · {stamp(entry.at)}
              </p>
            ))}
          </div>
        )}
        {accountOpen && (
          <div className="border-b border-line bg-surface px-4 py-3 text-sm">
            <p className="font-semibold">Adrian (Personal)</p>
            <UserButton />
            <SignedOut>
              <Link to="/login" className="mt-2 inline-flex min-h-11 items-center text-accent">
                Sign in
              </Link>
            </SignedOut>
            <p className="text-muted">This menu is not an account switcher. No second workspace exists.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setView("settings")}>
                Settings
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3"
                onClick={() => void toggleStop()}
              >
                {ws.halted ? "Clear stop" : "Emergency stop"}
              </button>
            </div>
          </div>
        )}
        {ws.halted && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2">
            <p className="text-sm text-danger">Emergency stop is on. Sending and approvals are blocked.</p>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => void toggleStop()}>
              Clear stop
            </button>
          </div>
        )}

        <div className={`min-h-0 flex-1 ${view === "chat" ? "overflow-hidden" : "overflow-auto"}`}>
          {view === "command" && (
            <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
              <div className="masthead flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="font-display text-3xl font-bold md:text-4xl">
                    {now ? greeting(now) : "Hello"}, <span className="text-accent">Adrian</span>
                  </h1>
                  <p className="text-sm text-muted">Your workspace, under your control.</p>
                </div>
                <p className="text-right text-sm text-muted">
                  {now
                    ? now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
                    : "—"}
                  <span className="mt-1 block font-display text-2xl text-fg">
                    {now ? now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}
                  </span>
                </p>
              </div>

              <section className="command-card rounded-panel bg-surface p-3 md:p-4">
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <button type="button" onClick={() => setAutonomy("ask")} className={`min-h-16 rounded-panel px-4 text-left ${autonomy === "ask" ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}>
                    <span className="block text-sm font-bold">ASK</span>
                    <span className="block text-xs">Review and approve before action</span>
                  </button>
                  <button type="button" onClick={() => setAutonomy("automatic")} className={`min-h-16 rounded-panel px-4 text-left ${autonomy === "automatic" ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}>
                    <span className="block text-sm font-bold">AUTOMATIC</span>
                    <span className="block text-xs">Deletes and replacements still ask you</span>
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={memoryChoice === "on"}
                    onClick={() => {
                      if (memoryChoice === "on") {
                        setMemoryChoice("off");
                        return;
                      }
                      setArmMemory("composer");
                    }}
                    className="flex min-h-16 items-center justify-between gap-4 rounded-panel bg-surface-2 px-4 text-left"
                  >
                    <span>
                      <span className="block text-sm font-semibold">Memory: {memoryChoice === "on" ? "ON" : "OFF"}</span>
                      <span className="block text-xs text-muted">Opt in before this command can read notes.</span>
                    </span>
                    <span className={`relative h-6 w-11 rounded-full ${memoryChoice === "on" ? "bg-accent" : "bg-line"}`}>
                      <span className={`absolute top-0.5 size-5 rounded-full bg-fg ${memoryChoice === "on" ? "right-0.5" : "left-0.5"}`} />
                    </span>
                  </button>
                </div>
                <form
                  className="mt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendCommand();
                  }}
                >
                  <div className="mb-2 flex flex-wrap gap-2">
                    {([
                      ["ask", "Ask"],
                      ["research", "Research"],
                      ["agent", "Agent"],
                      ["build", "Build"],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`min-h-11 rounded-full px-3 text-sm ${commandMode === id ? "bg-accent text-accent-ink" : "border border-line text-muted"}`}
                        onClick={() => setCommandMode(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="What would you like to work on?"
                    rows={3}
                    className="w-full resize-none rounded-panel border border-line bg-bg px-3 py-3 text-sm"
                  />
                  {staged && (
                    <p className="mt-2 text-xs text-muted">Staged: {staged.name}. It stays in this browser and is sent only if you press Send.</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => fileRef.current?.click()}>
                      <Paperclip className="size-4" /> Attach
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm"
                      onClick={() => {
                        setContextOpen((open) => !open);
                        setToolsOpen(false);
                      }}
                    >
                      <Database className="size-4" /> Add Context
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm"
                      onClick={() => {
                        setToolsOpen((open) => !open);
                        setContextOpen(false);
                      }}
                    >
                      <Wrench className="size-4" /> Tools
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => setView("agents")}>
                      <Bot className="size-4" /> Agents
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => setProjectOpen(true)}>
                      <Folder className="size-4" /> Projects
                    </button>
                    <VoiceLevelMeter level={voiceLevel} listening={voiceListening} className="mr-1" />
                    <button type="button" title={voiceMicAriaLabel(voiceListening)} className={`ml-auto grid size-11 place-items-center rounded-panel border border-line ${voiceListening ? "bg-accent text-accent-ink" : "text-muted"}`} onClick={() => void listen()} aria-label={voiceMicAriaLabel(voiceListening)} aria-keyshortcuts={VOICE_TOGGLE_SHORTCUT.ariaKeyshortcuts} aria-pressed={voiceListening}>
                      {voiceListening ? <Square className="size-4" /> : <Mic className="size-4" />}
                    </button>
                    <button type="submit" disabled={busy || ws.halted} className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
                      <Send className="size-4" /> {busy ? "Sending" : "Send"}
                    </button>
                  </div>
                </form>
                {contextOpen && (
                  <div className="mt-3 rounded-panel border border-line bg-bg p-3 text-sm">
                    <label className="flex items-center justify-between gap-3">
                      Project
                      <select value={projectChoice} onChange={(event) => setProjectChoice(event.target.value)} className="max-w-[60%] bg-transparent">
                        <option value="">None</option>
                        {ws.projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mt-3 flex items-start gap-2">
                      <input type="checkbox" checked={temporary} onChange={(event) => setTemporary(event.target.checked)} />
                      Temporary chat. Export skips it unless you include temporary chats. This is not the same as memory off.
                    </label>
                    <p className="mt-2 text-xs text-muted">
                      {memoryChoice === "off"
                        ? "Memory is off, so saved notes are not added to this command."
                        : "Memory is on. The next chat can read global notes and notes for the selected project. Older chats are not copied in."}
                    </p>
                  </div>
                )}
                {toolsOpen && (
                  <ul className="mt-3 space-y-2 rounded-panel border border-line bg-bg p-3 text-sm">
                    <li>Grok 4.5 — available when you press Send. Speak reads a reply only when you press Speak.</li>
                    <li className="text-muted">GPT, Claude, Gemini, OpenRouter — no keys stored.</li>
                    <li>REA — official CLI from github.com/morluto/rea. Doctor and file inspect run here. Native decompilers are not installed.</li>
                    <li className="text-muted">Web research runs only when a search provider is configured. Otherwise the check refuses and creates no citations.</li>
                    <li className="text-muted">Image and video — paid APIs, not called. HP — not paired.</li>
                    <li>
                      <button type="button" className="min-h-11 text-accent" onClick={() => { setView("agents"); void checkRea(); }}>
                        Run REA doctor
                      </button>
                    </li>
                  </ul>
                )}
              </section>

              <div className="flex gap-2 overflow-x-auto pb-1">
                <Quick label="Create Project" icon={Folder} tone="text-accent" onClick={() => setProjectOpen(true)} />
                <Quick label="Run Agent" icon={Bot} tone="text-info" onClick={() => { setView("agents"); void checkRea(); }} />
                <Quick label="Research" icon={Search} tone="text-ok" onClick={() => { setView("research"); if (staged) void inspectWithRea(staged, "research"); else void checkRea(); }} />
                <Quick label="Generate Image" icon={Image} tone="text-warn" onClick={() => explain("Image generation is a paid API and is not called from this app.")} />
                <Quick label="Generate Video" icon={Video} tone="text-accent" onClick={() => explain("Video generation is a paid API and is not called from this app.")} />
                <Quick label="Analyze File" icon={FileText} tone="text-info" onClick={() => { if (staged) void inspectWithRea(staged, "research"); else { inspectNext.current = "research"; fileRef.current?.click(); } }} />
                <Quick label="More Tools" icon={Wrench} tone="text-muted" onClick={() => setToolsOpen(true)} />
              </div>
              <div className="flex items-center gap-2">
                <VoiceLevelMeter level={voiceLevel} listening={voiceListening} />
                <VoiceModeBadge
                  mode={voiceMode}
                  listening={voiceListening}
                  onToggle={() => applyVoiceMode(toggleVoiceMode(voiceMode))}
                />
              </div>
              {notice && <p className="rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{notice}</p>}
              {error && <p className="text-sm text-danger">{error}</p>}
              <ServiceBoard
                grokConfigured={grokConfigured === true}
                notion={notion}
                mcp={mcpServers.some((server) => server.state === "connected")
                  ? { state: "Connected", detail: `${mcpServers.filter((server) => server.state === "connected").length} MCP server answered. Tools are only the ones it returned.` }
                  : { state: "Not connected", detail: mcpServers.find((server) => server.error)?.error || "No MCP server has answered a handshake. Nothing is called." }}
                onSetup={(message) => setNotice(message)}
                onDisconnect={() => {
                  void notionDisconnect().then((status) => {
                    setNotion(status);
                    setNotice(status.detail);
                  });
                }}
              />

              <div className="grid gap-3 xl:grid-cols-3">
                <Panel title="Active Projects" action="View all" onAction={() => setView("projects")}>
                  {ws.projects.length === 0 && <p className="text-sm text-muted">No projects yet. Create one and it stays on this device until you export it.</p>}
                  {ws.projects.slice(0, 3).map((project) => {
                    const chats = ws.chats.filter((chat) => chat.projectId === project.id).length;
                    const notes = ws.memories.filter((item) => item.projectId === project.id && !item.archived).length;
                    return (
                      <button key={project.id} type="button" onClick={() => setView("projects")} className="mt-3 w-full rounded-panel bg-bg p-3 text-left">
                        <span className="flex items-start gap-3">
                          <span className="grid size-10 place-items-center rounded-panel bg-accent/15 text-accent"><Folder className="size-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{project.name}</span>
                            <span className="block text-sm text-muted">{project.description || "No description yet."}</span>
                          </span>
                          <span className="rounded-full bg-surface-2 px-2 py-1 text-xs text-muted">On device</span>
                        </span>
                        <span className="mt-3 block text-xs text-muted">{chats} chats · {notes} notes · no cloud copy</span>
                      </button>
                    );
                  })}
                </Panel>
                <Panel title="System Status" action="Details" onAction={() => setView("integrations")}>
                  <StatusRow icon={Database} name="Memory" detail={memoryChoice === "on" ? "On for the next command" : "Off for the next command"} pill={memoryChoice === "on" ? "On" : "Off"} tone={memoryChoice === "on" ? "ok" : "muted"} />
                  <StatusRow icon={Database} name="Database" detail={databaseDetail} pill={databasePill} tone={databasePill === "Refused" ? "danger" : "muted"} />
                  <StatusRow icon={Bot} name="Voice" detail="Browser speech when this browser has it. Not a realtime voice session. Nothing is spoken until you press speak." pill="Not realtime" tone="muted" />
                  <StatusRow icon={Bot} name="REA" detail="CLI from GitHub runs. Native engines are not installed." pill="Partial" tone="muted" />
                  <StatusRow icon={Square} name="HP" detail="Local device integration" pill="Not paired" tone="danger" />
                  <p className="mt-3 text-xs text-muted">Grok: {grok}. Checked {stamp(checkedAt) || checkedAt}. {system}</p>
                </Panel>
                <Panel title="Recent Activity" action="View all" onAction={() => setView("activity")}>
                  {ws.audit.length === 0 && <p className="text-sm text-muted">No activity yet. Actions you take show up here. Nothing is invented.</p>}
                  {ws.audit.slice(0, 5).map((entry) => (
                    <button key={entry.id} type="button" onClick={() => setView("activity")} className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm">
                      <span className="truncate">{humanAction(entry.action)}</span>
                      <span className="shrink-0 text-xs text-muted">{stamp(entry.at)}</span>
                    </button>
                  ))}
                </Panel>
              </div>

              <section className="flex flex-col gap-3 rounded-panel border border-accent/40 bg-surface p-4 md:flex-row md:items-center">
                <Shield className="size-8 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Protected actions require your approval.</p>
                  <p className="text-sm text-muted">Deletes, replacements, and governance changes ask even in Automatic mode. Stop blocks them.</p>
                </div>
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink md:w-auto"
                  onClick={() => void toggleStop()}
                >
                  {ws.halted ? "Clear stop" : "Emergency stop"}
                </button>
                <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted">
                  <span className="rounded-panel border border-line px-2 py-2"><Lock className="mx-auto mb-1 size-4 text-accent" />Owner control</span>
                  <span className="rounded-panel border border-line px-2 py-2"><Database className="mx-auto mb-1 size-4 text-info" />Data isolation</span>
                  <span className="rounded-panel border border-line px-2 py-2"><Shield className="mx-auto mb-1 size-4 text-ok" />Safe by default</span>
                </div>
              </section>
            </div>
          )}

          {view === "chat" && (
            <ChatPane
              active={active}
              chats={ws.chats}
              projectId={chatProjectId}
              projectName={ws.projects.find((project) => project.id === chatProjectId)?.name ?? null}
              onClearProject={() => setChatProjectId(null)}
              busy={busy}
              liveText={liveText}
              halted={ws.halted}
              draft={draft}
              error={error}
              setDraft={setDraft}
              onPick={(id) => setActiveId(id)}
              onSend={() => void sendInChat()}
              onStop={stopReply}
              onRename={renameActive}
              onEdit={editMessage}
              onRegenerate={regenerate}
              onRetry={retryLast}
              onExport={exportActive}
              onDelete={() => {
                if (!active) return;
                requestProtected("delete", `delete-chat:${active.id}`, `Delete “${active.title}”`, "The transcript is removed. Saved notes stay until you delete them.", "Approve delete", () => {
                  setWs((prev) => pushAudit({ ...prev, chats: prev.chats.filter((chat) => chat.id !== active.id) }, "delete_chat", active.id, "approved"));
                  setActiveId(null);
                });
              }}
              onMemory={() => {
                if (!active) return;
                if (active.memory === "off") {
                  setArmMemory(active.id);
                  return;
                }
                setWs((prev) =>
                  pushAudit(
                    { ...prev, chats: prev.chats.map((chat) => (chat.id === active.id ? { ...chat, memory: "off" } : chat)) },
                    "memory_off",
                    active.id,
                    "retrieval stopped",
                  ),
                );
              }}
              onSave={(content) => {
                if (!active || active.memory !== "on") {
                  setError("Memory is off for this chat, so the note was not saved.");
                  return;
                }
                setWs((prev) =>
                  pushAudit(
                    addMemory(prev, { scope: "chat", text: content, source: active.title, projectId: active.projectId, chatId: active.id }),
                    "save_memory",
                    active.id,
                    "owner saved a note",
                  ),
                );
              }}
              onNew={openChat}
              onSpeak={(text) => void speak(text)}
              onListen={() => void listen()}
              onListenStop={() => void listen({ mode: "stop" })}
              onLiveUserTranscript={(text) => appendLiveVoiceUser(text)}
              onLiveAssistantTranscript={(text) => appendLiveVoiceAssistant(text)}
              onLiveVoiceError={(message) => setError(message)}
              onLiveVoiceNotice={(message) => setNotice(message)}
              speaking={speaking}
              voiceMode={voiceMode}
              voiceListening={voiceListening}
              voiceLevel={voiceLevel}
              onToggleVoiceMode={() => applyVoiceMode(toggleVoiceMode(voiceMode))}
              memoryChoice={active?.memory ?? memoryChoice}
              mode={active?.autonomy ?? autonomy}
              onComposerMemory={() => {
                if ((active?.memory ?? memoryChoice) === "on") {
                  if (active) {
                    setWs((prev) =>
                      pushAudit(
                        { ...prev, chats: prev.chats.map((chat) => (chat.id === active.id ? { ...chat, memory: "off" } : chat)) },
                        "memory_off",
                        active.id,
                        "retrieval stopped",
                      ),
                    );
                  } else setMemoryChoice("off");
                  return;
                }
                setArmMemory(active?.id ?? "composer");
              }}
              onComposerMode={(next) => {
                setAutonomy(next);
                if (!active) return;
                setWs((prev) => ({
                  ...prev,
                  chats: prev.chats.map((chat) => (chat.id === active.id ? { ...chat, autonomy: next } : chat)),
                }));
              }}
              stagedName={staged?.name ?? null}
              onAttach={() => fileRef.current?.click()}
              onAnalyze={() => {
                if (staged) void inspectWithRea(staged, "research");
                else {
                  inspectNext.current = "research";
                  fileRef.current?.click();
                }
              }}
              onDoctor={() => {
                setView("agents");
                void checkRea();
              }}
              providerChoices={providerChoices(grokConfigured)}
              providerChoice={providerChoice}
              onProvider={(id) => {
                if (id === "grok") setProviderChoice("grok");
              }}
            />
          )}

          {view === "projects" && (
            <section className="p-4 md:p-6">
              <div className="masthead glow-card flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-2xl bg-accent/20 text-accent"><Folder className="size-5" /></span>
                  <div>
                    <h2 className="font-display text-3xl font-bold">Projects</h2>
                    <p className="text-sm text-muted">Records on this device. Oak Bridge and BridgePoint stay outside this app.</p>
                  </div>
                </div>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => setProjectOpen(true)}>
                  <Plus className="size-4" /> New Project
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-panel bg-accent px-3 py-2 text-sm text-white">On this device ({ws.projects.length})</span>
                <span className="rounded-panel border border-line px-3 py-2 text-sm text-muted">External (2) · unchanged</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {ws.projects.length === 0 && (
                  <article className="glow-card rounded-panel border border-line bg-surface p-4 lg:col-span-2">
                    <p className="font-semibold">No projects on this device yet.</p>
                    <p className="mt-1 text-sm text-muted">Create one to keep its chats, notes, and files apart. Progress, tasks, and cloud files are not invented.</p>
                  </article>
                )}
                {ws.projects.map((project) => {
                  const chats = ws.chats.filter((chat) => chat.projectId === project.id).length;
                  const notes = ws.memories.filter((item) => item.projectId === project.id && !item.archived).length;
                  const files = ws.files.filter((file) => file.projectId === project.id).length;
                  return (
                    <article key={project.id} className="glow-card rounded-panel border border-line bg-surface p-4">
                      <div className="flex items-start gap-3">
                        <span className="grid size-11 place-items-center rounded-2xl bg-accent/15 text-accent"><Folder className="size-5" /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold">{project.name}</h3>
                            <span className="rounded-full border border-ok/40 px-2 py-0.5 text-xs text-ok">On device</span>
                          </div>
                          <p className="text-sm text-muted">{project.description || "No description yet."}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-muted">Updated {stamp(project.createdAt)} · {chats} chats · {notes} notes · {files} files</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm text-white" onClick={() => { setChatProjectId(project.id); setProjectChoice(project.id); setActiveId(ws.chats.find((chat) => chat.projectId === project.id)?.id ?? null); setView("chat"); }}>Open chats</button>
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setMemoryTab("project"); setMemoryProject(project.id); setMemoryScope("project"); setView("memory"); }}>Notes</button>
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setView("files")}>Files</button>
                        <button
                          type="button"
                          className="min-h-11 rounded-panel border border-line px-3 text-sm"
                          onClick={() =>
                            requestProtected("delete", `delete-project:${project.id}`, `Delete “${project.name}”`, "Chats and files stay in the workspace and are unlinked. Notes stay in Memory and are labeled if this project is gone. Nothing is erased except the project record.", "Approve delete", () => {
                              setWs((prev) =>
                                pushAudit(
                                  {
                                    ...prev,
                                    projects: prev.projects.filter((item) => item.id !== project.id),
                                    chats: prev.chats.map((chat) => (chat.projectId === project.id ? { ...chat, projectId: null } : chat)),
                                    files: prev.files.map((file) => (file.projectId === project.id ? { ...file, projectId: null } : file)),
                                  },
                                  "delete_project",
                                  project.id,
                                  "approved",
                                ),
                              );
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  );
                })}
                {EXTERNAL.map((item) => (
                  <article key={item.name} className="rounded-panel border border-line bg-surface p-4">
                    <div className="flex items-start gap-3">
                      <span className={`grid size-11 place-items-center rounded-2xl ${item.tone}`}>{item.mark}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{item.name}</h3>
                          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">External</span>
                        </div>
                        <p className="text-sm text-muted">{item.detail}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted">No tasks, files, or progress are read from that product.</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {view === "memory" && (
            <section className="p-4 md:p-6">
              <div className="masthead">
                <h2 className="font-display text-3xl font-bold">Memory</h2>
                <p className="text-sm text-muted">Your context, notes, and knowledge. Kept in this browser, not a remote database.</p>
              </div>
              <div className={`glow-card mt-4 grid gap-4 rounded-panel border p-4 md:grid-cols-2 ${memoryChoice === "on" ? "border-ok/40" : "border-danger/40"}`}>
                <div className="flex items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent"><Database className="size-5" /></span>
                  <div>
                    <p className="font-semibold">Memory: <span className={memoryChoice === "on" ? "text-ok" : "text-danger"}>{memoryChoice === "on" ? "ON" : "OFF"}</span></p>
                    <p className="text-sm text-muted">{memoryChoice === "on" ? "The next command can read notes in its scope. Existing chats stay off until you enable them there." : "A memory-off chat cannot read or save notes."}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted">Enable it only when you want notes used in a later command. This does not copy old chats into memory.</p>
                  <button type="button" className="min-h-11 shrink-0 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => memoryChoice === "on" ? setMemoryChoice("off") : setArmMemory("composer")}>
                    {memoryChoice === "on" ? "Turn off" : "Enable Memory"}
                  </button>
                </div>
              </div>
              <div className="mt-4 flex gap-2 overflow-x-auto">
                {([
                  ["mine", "My Memory"],
                  ["project", "Project Memory"],
                  ["transfer", "Imports & Exports"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => { setMemoryTab(id); if (id === "project") setMemoryScope("project"); if (id === "mine") setMemoryScope("global"); }} className={`min-h-11 shrink-0 rounded-panel px-4 text-sm ${memoryTab === id ? "bg-accent text-white" : "border border-line text-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted">{memoryTab === "project" ? "Project notes stay inside the project you pick." : memoryTab === "transfer" ? "Export is a JSON file with a hash. Import refuses a file whose hash does not match." : "Personal notes are global on this device. They are not used while memory is off."}</p>
              {memoryTab === "transfer" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => void downloadArchive()}>Export archive</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" onClick={() => setView("settings")}>Import on Settings</button>
                </div>
              )}
              <div className="mt-4 grid gap-3 md:grid-cols-[16rem_1fr]">
                <div className="glow-card rounded-panel border border-line bg-surface p-4 text-sm">
                  <p className="font-semibold">Memory overview</p>
                  <p className="mt-3 flex justify-between"><span className="text-muted">Status</span><span className={memoryChoice === "on" ? "text-ok" : "text-danger"}>{memoryChoice === "on" ? "ON" : "OFF"}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Stored items</span><span>{ws.memories.filter((item) => !item.archived).length}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Text size</span><span>{formatBytes(memoryBytes)}</span></p>
                  <p className="mt-3 text-xs text-muted">This size is the note text on this device. It is not a cloud quota.</p>
                </div>
                <div className="grid gap-2">
                <textarea value={memoryText} onChange={(event) => setMemoryText(event.target.value)} placeholder="Write a note you want kept" rows={3} className="rounded-panel border border-line bg-surface px-3 py-2 text-sm" />
                <div className="flex flex-wrap gap-2">
                  <select value={memoryScope} onChange={(event) => setMemoryScope(event.target.value as MemoryScope)} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
                    <option value="global">Global</option>
                    <option value="project">Project</option>
                  </select>
                  {memoryScope === "project" && (
                    <select value={memoryProject} onChange={(event) => setMemoryProject(event.target.value)} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
                      <option value="">Choose project</option>
                      {ws.projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
                    onClick={() => {
                      if (memoryScope === "project" && !memoryProject) {
                        setError("Pick a project for a project note.");
                        return;
                      }
                      setWs((prev) =>
                        pushAudit(
                          addMemory(prev, { scope: memoryScope, text: memoryText, source: "owner", projectId: memoryProject || null, chatId: null }),
                          "save_memory",
                          "memory",
                          memoryScope,
                        ),
                      );
                      setMemoryText("");
                      setError(null);
                    }}
                  >
                    Save note
                  </button>
                </div>
                <input value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="Search notes" className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm" />
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived
                </label>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {memories.length === 0 && <li className="glow-card rounded-panel border border-line bg-surface p-6 text-center text-sm text-muted">No saved memory in this view. Nothing is stored while you leave memory off.</li>}
                {memories.map((item) => (
                  <li key={item.id} className="rounded-panel border border-line bg-surface p-3 text-sm">
                    {editId === item.id ? (
                      <textarea value={editText} onChange={(event) => setEditText(event.target.value)} className="min-h-20 w-full bg-transparent" />
                    ) : (
                      <p className="whitespace-pre-wrap">{item.text}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">{item.scope}{item.scope === "project" ? (ws.projects.some((project) => project.id === item.projectId) ? "" : " · project removed, note kept") : ""} · {stamp(item.updatedAt)}{item.archived ? " · archived" : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {editId === item.id ? (
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => { setWs((prev) => pushAudit(reviseMemory(prev, item.id, editText), "save_memory", item.id, "revised")); setEditId(null); }}>Save edit</button>
                      ) : (
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => { setEditId(item.id); setEditText(item.text); }}>Edit</button>
                      )}
                      <button
                        type="button"
                        className="min-h-11 rounded-panel border border-line px-3"
                        onClick={() =>
                          setWs((prev) =>
                            pushAudit(
                              { ...prev, memories: prev.memories.map((note) => (note.id === item.id ? { ...note, archived: !note.archived, updatedAt: new Date().toISOString() } : note)) },
                              "archive_memory",
                              item.id,
                              "toggled",
                            ),
                          )
                        }
                      >
                        {item.archived ? "Restore" : "Archive"}
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-panel border border-line px-3"
                        onClick={() =>
                          requestProtected("delete", `delete-memory:${item.id}`, "Delete this note", "The current text and its versions are removed from this browser.", "Approve delete", () => {
                            setWs((prev) => pushAudit({ ...prev, memories: prev.memories.filter((note) => note.id !== item.id) }, "delete_memory", item.id, "approved"));
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view === "agents" && (
            <>
            <ReaPanel
              title="Agents"
              lead="REA checks a file. Workspace lookup lists projects and chats, then searches notes. It does not call a model, browse the web, or mark itself running."
              report={reaReport}
              busy={reaBusy}
              onCheck={() => void checkRea()}
              onInspect={staged ? () => void inspectWithRea(staged, "agents") : null}
            />
            <form
              className="mx-4 mb-6 rounded-panel border border-line bg-surface p-4 md:mx-6"
              onSubmit={(event) => {
                event.preventDefault();
                runLookup(lookupQuery);
              }}
            >
              <p className="font-semibold">Workspace lookup</p>
              <p className="mt-1 text-sm text-muted">Three local steps, in order. You approve them before they run. Stop blocks them.</p>
              <input value={lookupQuery} onChange={(event) => setLookupQuery(event.target.value)} placeholder="Word to find in notes" className="mt-3 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
              <button type="submit" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={ws.halted || !lookupQuery.trim()}>Run lookup</button>
            </form>
            <form
              className="mx-4 mb-6 rounded-panel border border-line bg-surface p-4 md:mx-6"
              onSubmit={(event) => {
                event.preventDefault();
                void runPlanner();
              }}
            >
              <p className="font-semibold">Bounded planner</p>
              <p className="mt-1 text-sm text-muted">Grok may call only three local reads: projects, chats, and notes. It stops after four steps or twenty seconds. It cannot use a shell, the network, or files. A live tool call was not verified in the last test. Run spends a model request.</p>
              <textarea value={agentGoal} onChange={(event) => setAgentGoal(event.target.value)} placeholder="What should the planner look up?" rows={3} className="mt-3 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={ws.halted || agentBusy}>Run planner</button>
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-4 text-sm disabled:opacity-50"
                  disabled={!agentBusy}
                  onClick={() => {
                    agentAbort.current?.abort();
                    setAgentNote("Stopped. The unfinished reply was not saved.");
                  }}
                >
                  Stop this run
                </button>
              </div>
              {agentNote ? <p className="mt-3 text-sm text-muted">{agentNote}</p> : null}
              {agentLog.length > 0 && (
                <ol className="mt-3 space-y-1 text-sm">
                  {agentLog.map((entry) => (
                    <li key={`${entry.step}-${entry.tool}`}>{entry.step}. {entry.tool} — {entry.ok ? "ok" : "failed"} — {entry.detail}</li>
                  ))}
                </ol>
              )}
            </form>
            <FleetPanel mode="agents" ws={ws} setWs={setWs} />
            </>
          )}
          {view === "runs" && <FleetPanel mode="runs" ws={ws} setWs={setWs} />}
          {view === "connected" && (
            <section className="space-y-4 p-4 md:p-6">
              <h2 className="font-display text-3xl font-bold">Connected</h2>
              <p className="text-sm text-muted">Setup explains what is missing. A service is connected only after the server says so.</p>
              <ServiceBoard
                grokConfigured={grokConfigured === true}
                notion={notion}
                mcp={mcpServers.some((server) => server.state === "connected")
                  ? { state: "Connected", detail: `${mcpServers.filter((server) => server.state === "connected").length} MCP server answered. Tools are only the ones it returned.` }
                  : { state: "Not connected", detail: mcpServers.find((server) => server.error)?.error || "No MCP server has answered a handshake. Nothing is called." }}
                onSetup={(message) => setNotice(message)}
                onDisconnect={() => {
                  void notionDisconnect().then((status) => {
                    setNotion(status);
                    setNotice(status.detail);
                  });
                }}
              />
              <form
                className="rounded-panel border border-line bg-surface p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const query = notionQuery.trim();
                  if (!query || ws.halted) return;
                  void notionCommand({ data: { text: `Search my Notion for ${query}`, confirmed: false, pageId: null } }).then((result) => {
                    setNotionPages(result.pages);
                    setNotionNote(result.error || (result.pages.length ? "" : "Notion returned no pages."));
                  }).catch(() => setNotionNote("Notion could not be reached. Nothing was searched."));
                }}
              >
                <h3 className="font-semibold">Search Notion</h3>
                <p className="mt-1 text-sm text-muted">This calls the server. It does not invent pages. A page change still asks before it writes.</p>
                <input value={notionQuery} onChange={(event) => setNotionQuery(event.target.value)} placeholder="Page or database name" className="mt-3 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <button type="submit" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={ws.halted || !notionQuery.trim()}>Search</button>
                {notionNote && <p className="mt-3 text-sm text-muted">{notionNote}</p>}
                <ul className="mt-2 space-y-2">
                  {notionPages.map((page) => (
                    <li key={page.id}>
                      <a className="text-sm text-accent" href={page.url} target="_blank" rel="noreferrer">{page.title}</a>
                    </li>
                  ))}
                </ul>
              </form>
              <form
                className="rounded-panel border border-line bg-surface p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (ws.halted || !mcpUrl.trim()) return;
                  void mcpSave({ data: { label: mcpLabel, url: mcpUrl, token: mcpToken } }).then((result) => {
                    setMcpToken("");
                    if (!result.ok) {
                      setNotice(result.error);
                      return;
                    }
                    setMcpServers(result.servers);
                    setMcpLabel("");
                    setMcpUrl("");
                    const connected = result.servers.some((server) => server.state === "connected");
                    setNotice(connected ? "The MCP server answered. It is connected." : result.servers.at(-1)?.error || "The MCP server did not answer. It is not connected.");
                  }).catch(() => setNotice("The MCP server could not be reached. Nothing was called."));
                }}
              >
                <h3 className="font-semibold">MCP server</h3>
                <p className="mt-1 text-sm text-muted">The token stays on the server. Connected means the server answered initialize and tools/list.</p>
                <input value={mcpLabel} onChange={(event) => setMcpLabel(event.target.value)} placeholder="Label" className="mt-3 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <input value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://mcp.example/tools" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <input value={mcpToken} onChange={(event) => setMcpToken(event.target.value)} type="password" placeholder="Token, optional" autoComplete="off" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <button type="submit" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={ws.halted || !mcpUrl.trim()}>Test and save</button>
                <ul className="mt-3 space-y-2">
                  {mcpServers.map((server) => (
                    <li key={server.id} className="rounded-panel border border-line px-3 py-2 text-sm">
                      <span className="font-semibold">{server.label}</span>
                      <span className="ml-2 text-muted">{server.host} · {server.state}</span>
                      <p className="text-muted">{server.error || server.tools.map((tool) => tool.name).join(", ") || "No tools returned."}</p>
                      <button
                        type="button"
                        className="mt-2 min-h-11 rounded-panel border border-line px-3"
                        onClick={() => {
                          void mcpRemove({ data: { id: server.id } }).then((result) => setMcpServers(result.servers));
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </form>
              {notice && <p className="rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{notice}</p>}
              <FleetPanel mode="connected" ws={ws} setWs={setWs} />
            </section>
          )}
          {view === "scheduled" && <FleetPanel mode="scheduled" ws={ws} setWs={setWs} />}
          {view === "tools" && <FleetPanel mode="tools" ws={ws} setWs={setWs} />}
          {view === "build" && (
            <section className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
              <h2 className="font-display text-3xl font-bold">Build</h2>
              <p className="text-sm text-muted">This page does not edit the repository, run a terminal, install packages, or create commits. A paired computer is required before any of that can run.</p>
              <ul className="space-y-2 text-sm">
                <li className="rounded-panel border border-line bg-surface p-3">Read this workspace’s projects, chats, and notes. Available from Ask: “show my projects”.</li>
                <li className="rounded-panel border border-line bg-surface p-3">Edit files, run tests, and use git. Not available. No files were changed.</li>
                <li className="rounded-panel border border-line bg-surface p-3">HP EliteBook and iPhone control. Not paired.</li>
              </ul>
            </section>
          )}
          {view === "research" && (
            <section className="p-4 md:p-6">
              <div className="masthead glow-card rounded-panel border border-line bg-surface p-4">
                <h2 className="font-display text-3xl font-bold">Research</h2>
                <p className="text-sm text-muted">A search runs only when the server has a search endpoint and key. Otherwise this refuses, does not call Grok, and creates no citations. Links appear only when the provider returned them.</p>
                <textarea value={researchText} onChange={(event) => setResearchText(event.target.value)} placeholder="What do you want to research?" rows={3} className="mt-3 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
                <button type="button" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={ws.halted} onClick={startResearch}>
                  Check research
                </button>
                {researchNote ? <p className="mt-3 text-sm text-muted">{researchNote}</p> : null}
                {researchCitations.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {researchCitations.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => (
                      <li key={item.url}>
                        <a className="text-accent underline" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-4">
                <ReaPanel
                  title="File inspection"
                  lead="REA inspect-artifact runs on text you stage. Web pages are not fetched."
                  report={reaReport}
                  busy={reaBusy}
                  onCheck={() => void checkRea()}
                  onInspect={staged ? () => void inspectWithRea(staged, "research") : null}
                />
              </div>
            </section>
          )}
          {view === "skills" && (
            <section className="space-y-4 p-4 md:p-6">
              <h2 className="font-display text-3xl font-bold">Skills</h2>
              <p className="text-sm text-muted">Built-in skills read this device. Not installed means the outside service is not connected. Nothing is marked installed unless it can run.</p>
              <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="Search skills" className="min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
              <div className="grid gap-3 md:grid-cols-2">
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).map((skill) => {
                  const on = skill.kind === "built-in" && enabledSkills[skill.id] !== false;
                  return (
                    <article key={skill.id} className="rounded-panel border border-line bg-surface p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold">{skill.name}</h3>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{skill.kind === "built-in" ? (on ? "On" : "Off") : "Not installed"}</span>
                      </div>
                      <p className="mt-2 text-sm">{skill.description}</p>
                      <p className="mt-1 text-sm text-muted">{skill.needs}</p>
                      <div className="mt-3 flex gap-2">
                        {skill.kind === "built-in" ? (
                          <button
                            type="button"
                            className="min-h-11 rounded-panel border border-line px-3 text-sm"
                            onClick={() => {
                              const next = { ...enabledSkills, [skill.id]: !on };
                              setEnabledSkills(next);
                              try {
                                localStorage.setItem("amcos.skills.v1", JSON.stringify(next));
                              } catch {
                                /* storage can refuse */
                              }
                            }}
                          >
                            {on ? "Turn off" : "Turn on"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink"
                          onClick={() => setNotice(runSkill(ws, skill, enabledSkills[skill.id] !== false).text)}
                        >
                          Run
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {notice && <p className="rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{notice}</p>}
            </section>
          )}
          {view === "files" && (
            <section className="p-4 md:p-6">
              <div className="masthead flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-3xl font-bold">Library</h2>
                  <p className="text-sm text-muted">Text, markdown, CSV, and JSON are read as text. PDF and images are stored only. They are not decoded.</p>
                </div>
                <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => fileRef.current?.click()}>Upload text</button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[16rem_1fr]">
                <aside className="glow-card rounded-panel border border-line bg-surface p-3 text-sm">
                  <p className="font-semibold">Text copies</p>
                  <p className="mt-2 text-xs text-muted">These are the words you attached, not the original file and not a cloud drive.</p>
                  <ul className="mt-3 space-y-1">
                    {ws.files.length === 0 && <li className="text-muted">No files yet.</li>}
                    {ws.files.map((file) => (
                      <li key={file.id}>
                        <button type="button" onClick={() => setOpenFileId(file.id)} className={`min-h-11 w-full rounded-panel px-2 text-left ${openFileId === file.id ? "bg-accent text-white" : ""}`}>
                          {file.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
                <div className="glow-card rounded-panel border border-line bg-surface p-4 text-sm">
                  {!ws.files.find((file) => file.id === openFileId) && <p className="text-muted">Select a file to read the text copy. Upload text from the button above, or attach a file on Command.</p>}
                  {ws.files.filter((file) => file.id === openFileId).map((file) => (
                    <div key={file.id}>
                      <p className="font-semibold">{file.name}</p>
                      <p className="text-xs text-muted">{formatBytes(file.bytes)} · {stamp(file.createdAt)} · {describeFile(file.name, file.text).summary}</p>
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-panel bg-bg p-3 text-sm">{file.text}</pre>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => void inspectWithRea({ name: file.name, text: file.text }, "research")}>Inspect text with REA</button>
                        <button
                          type="button"
                          className="min-h-11 rounded-panel border border-line px-3"
                          onClick={() =>
                            requestProtected("delete", `delete-file:${file.id}`, `Delete “${file.name}”`, "The text copy in this browser is removed.", "Approve delete", () => {
                              setOpenFileId(null);
                              setWs((prev) => pushAudit({ ...prev, files: prev.files.filter((item) => item.id !== file.id) }, "delete_file", file.id, "approved"));
                            })
                          }
                        >
                          Delete
                        </button>
                      </div>
                      <p className="mt-3 text-xs text-muted">REA inspect-artifact often rejects plain text. A failure stays a failure. It is not marked inspected.</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          {view === "integrations" && (
            <section className="p-4 md:p-6">
              <div className="masthead">
                <h2 className="font-display text-3xl font-bold">Integrations</h2>
                <p className="text-sm text-muted">{system}</p>
                <p className="text-xs text-muted">Last check {stamp(checkedAt) || checkedAt}. Green means that behavior was verified here. Configured means a key or setting exists and a live call was not verified.</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {CAPABILITIES.map((item) => {
                  const live = isVerifiedCapability(item.status);
                  return (
                    <article key={item.id} className="glow-card rounded-panel border border-line bg-surface p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold">{item.name}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${live ? "border-ok/40 text-ok" : item.status === "blocked" || item.status === "paid_required" ? "border-danger/40 text-danger" : "border-line text-muted"}`}>
                          {statusWord(item.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted">{item.why}</p>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {view === "activity" && (
            <section className="p-4 md:p-6">
              <div className="masthead">
                <h2 className="font-display text-3xl font-bold">Activity</h2>
                <p className="text-sm text-muted">Only actions this app actually recorded. Nothing is filled in to look busy.</p>
              </div>
              <input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Filter activity" className="mt-4 min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" aria-label="Filter activity" />
              <ul className="mt-4 space-y-2">
                {ws.audit.length === 0 && <li className="glow-card rounded-panel border border-line bg-surface p-6 text-sm text-muted">No events yet.</li>}
                {ws.audit.filter((entry) => `${humanAction(entry.action)} ${entry.result}`.toLowerCase().includes(activityQuery.trim().toLowerCase())).length === 0 && ws.audit.length > 0 && (
                  <li className="text-sm text-muted">No events match that filter.</li>
                )}
                {ws.audit.filter((entry) => `${humanAction(entry.action)} ${entry.result}`.toLowerCase().includes(activityQuery.trim().toLowerCase())).map((entry) => (
                  <li key={entry.id} className="glow-card flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line bg-surface p-3 text-sm">
                    <div>
                      <p className="font-semibold">{humanAction(entry.action)}</p>
                      <p className="text-muted">{entry.result}</p>
                    </div>
                    <p className="text-xs text-muted">{stamp(entry.at)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view === "help" && (
            <section className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
              <h2 className="font-display text-3xl font-bold">Help</h2>
              <p className="text-sm text-muted">The pictures of this product are a layout. Green checks, file counts, and “completed” tasks in those pictures are not live data.</p>
              <ul className="space-y-2 text-sm">
                <li className="rounded-panel border border-line bg-surface p-3"><span className="font-semibold">Chat.</span> Ask sends a normal question to Grok when you press Send. Notion is called only when the server has a token. Gmail, search, image, video, and the computer are refused.</li>
                <li className="rounded-panel border border-line bg-surface p-3"><span className="font-semibold">Bots & Agents.</span> Templates and custom bots are saved on this device. Run worker once on the Runs screen. Nothing runs in the background.</li>
                <li className="rounded-panel border border-line bg-surface p-3"><span className="font-semibold">Build.</span> No repository is edited and no terminal runs until a computer is paired.</li>
                <li className="rounded-panel border border-line bg-surface p-3"><span className="font-semibold">Connected.</span> Setup does not connect the service. Grok shows “Key present” only when the server key exists.</li>
              </ul>
            </section>
          )}
          {view === "settings" && (
            <section className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
              <h2 className="font-display text-3xl font-bold">Settings</h2>
              <div className="rounded-panel border border-line bg-surface p-4 text-sm">
                <p className="font-semibold">Appearance</p>
                <p className="mt-1 text-muted">The theme is saved in this browser. It does not change a server setting.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["dark", "light", "system"] as const).map((choice) => (
                    <button key={choice} type="button" className={`min-h-11 rounded-panel border px-3 ${theme === choice ? "border-accent bg-accent text-accent-ink" : "border-line"}`} onClick={() => setTheme(choice)}>
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-panel border border-line bg-surface p-4 text-sm">
                <p className="font-semibold">Provider failover</p>
                <p className="mt-1 text-muted">Off. A failed or unconfigured provider is not replaced with another one. Chat still sends only through Grok when that key is present.</p>
              </div>
              <p className="text-sm text-muted">Storage on this device: {formatBytes(storedBytes)}. {syncNote}</p>
              {serverHeld && (
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() =>
                    void publishServerCopy().then((result) => {
                      if (!result.ok) setError(result.error);
                    })
                  }
                >
                  Save this browser copy over the server copy
                </button>
              )}
              <div className="rounded-panel border border-line bg-surface p-4 text-sm">
                <p className="font-semibold">How to use this</p>
                <ul className="mt-2 space-y-2 text-muted">
                  <li>Command is home. Ask is the default. Automatic still asks before a delete or a replace.</li>
                  <li>Memory is off until you confirm it. A memory-off chat cannot read or save notes.</li>
                  <li>Open chats on a project shows only that project’s chats. Show all chats clears the filter.</li>
                  <li>Research runs only when a search endpoint and key are set. A missing provider refuses and creates no citations. Links are only URLs the provider returned.</li>
                  <li>Workspace lookup is three local reads. The bounded planner can ask Grok to use those same reads. It is not a general agent, and Stop this run is not Emergency stop.</li>
                  <li>Files are text copies in this browser. REA may reject them. A rejection is not an inspection.</li>
                  <li>Stop this reply cancels only the current answer. It is not Emergency stop. The unfinished answer is not saved. The provider may still charge for text it generated before it saw the cancel.</li>
                  <li>Stop blocks new sends on this page and on the server. A signed-out request cannot clear it. The stop file survives a process restart on this machine. It is not durable on a serverless disk. Without a database URL the server copy is a file on this machine, not cloud backup. Your phone keeps its own copy.</li>
                  <li>Replies appear as Grok writes them. A stopped, empty, or broken reply is not saved.</li>
                  <li>If this browser and the server both already have a copy, this page keeps the browser copy until you choose to replace the server copy.</li>
                  <li>Grok, voice, REA, and saving a server copy require a signed-in owner. A refused sign-in does not spend the model.</li>
                  <li>Oak Bridge and BridgePoint are external labels. This app does not open them.</li>
                  <li>A dedicated database needs a new Supabase organization. The current free organization is already full.</li>
                </ul>
              </div>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm"
                onClick={() => void toggleStop()}
              >
                <Square className="size-4" /> {ws.halted ? "Clear emergency stop" : "Emergency stop"}
              </button>
              <div className="rounded-panel border border-line bg-surface p-4">
                <p className="font-semibold">Archive</p>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={includeTemporary} onChange={(event) => setIncludeTemporary(event.target.checked)} />
                  Include temporary chats
                </label>
                <button type="button" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => void downloadArchive()}>
                  Export archive
                </button>
                <label className="mt-3 block text-sm">
                  Import archive
                  <input
                    type="file"
                    accept="application/json"
                    className="mt-1 block w-full text-sm"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onImportFile(file);
                    }}
                  />
                </label>
                {importError && <p className="mt-2 text-sm text-danger">{importError}</p>}
                {importPreview && (
                  <div className="mt-3 text-sm">
                    <p>{importPreview.chats} chats · {importPreview.memories} notes · {importPreview.projects} projects. Hash matched.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => { setWs((prev) => pushAudit(mergeWorkspace(prev, importPreview.workspace), "import_merge", "archive", "merged")); setImportPreview(null); }}>
                        Merge
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-panel border border-line px-3"
                        onClick={() =>
                          requestProtected("overwrite", `import-replace:${importPreview.workspace.version}`, "Replace this workspace", "Current chats, notes, projects, and files are replaced by the archive.", "Approve replace", () => {
                            setWs(() => pushAudit(importPreview.workspace, "import_replace", "archive", "replaced"));
                            setImportPreview(null);
                          })
                        }
                      >
                        Replace
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-panel border border-line bg-surface p-4 text-sm">
                <p className="font-semibold">Requirement record</p>
                <p className="mt-1 text-muted">Verified {counts.verified} · In the app {counts.implemented} · Blocked {counts.blocked} · Planned {counts.planned} · Deferred {counts.deferred}</p>
                <ul className="mt-2 space-y-1 text-muted">
                  {REQUIREMENTS.filter((row) => row.status === "blocked" || row.status === "deferred").map((row) => (
                    <li key={row.id}>{row.text} — {row.note}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.json,.csv,.pdf,.png,.jpg,.jpeg,.js,.ts,.mjs,text/plain,application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onPicked(file);
        }}
      />

      {projectOpen && (
        <Overlay>
          <h3 className="font-display text-2xl font-bold">Create project</h3>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Name" className="mt-3 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
          <textarea value={projectAbout} onChange={(event) => setProjectAbout(event.target.value)} placeholder="Description" rows={3} className="mt-2 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => setProjectOpen(false)}>Cancel</button>
            <button type="button" className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink" onClick={saveProject}>Create</button>
          </div>
        </Overlay>
      )}
      {armMemory && (
        <Overlay>
          <h3 className="font-display text-2xl font-bold">Enable saved memory?</h3>
          <p className="mt-2 text-sm text-muted">Retrieval starts for this command or chat. Earlier messages are not copied into global memory. Other projects stay out. You can turn it off again.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => setArmMemory(null)}>Cancel</button>
            <button type="button" className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink" onClick={enableMemory}>Enable</button>
          </div>
        </Overlay>
      )}
      {pending && (
        <Overlay>
          <h3 className="font-display text-2xl font-bold">Approval required</h3>
          <p className="mt-2 text-sm font-semibold">{pending.label}</p>
          <p className="mt-1 text-sm text-muted">{pending.detail} Automatic mode does not approve this.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => setPending(null)}>Deny</button>
            <button type="button" className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink" onClick={confirmPending}>{pending.confirm}</button>
          </div>
        </Overlay>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Primary">
        {NAV.filter((item) => item.id === "command" || item.id === "agents" || item.id === "build" || item.id === "projects").map((item) => {
          const Icon = item.icon;
          const on = view === item.id;
          return (
            <button key={item.id} type="button" className={`flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] ${on ? "text-accent" : "text-muted"}`} onClick={() => { setView(item.id); setNavOpen(false); }}>
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
        <button type="button" className="flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] text-muted" onClick={() => setNavOpen(true)}>
          <Menu className="size-4" />
          More
        </button>
      </nav>

      <LiveVoiceBar
        isOverlayMicOpen={() =>
          Boolean(
            voiceListening ||
              voiceSession.current?.isOpen ||
              voiceSession.current?.isCapturing ||
              listenMintAbortRef.current,
          )
        }
        stopOverlayMic={() => void listen({ mode: "stop" })}
        onUserTranscript={(text) => appendLiveVoiceUser(text)}
        onAssistantTranscript={(text) => appendLiveVoiceAssistant(text)}
        onError={(message) => setError(message)}
        onNotice={(message) => setNotice(message)}
        askValue={draft}
        onAskChange={setDraft}
        dictating={voiceListening}
        onDictateToggle={() => void listen()}
        modelPickerSlot={
          <span
            className="inline-flex max-w-[9rem] items-center gap-1 truncate rounded-full border border-white/10 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100"
            data-testid="composer-model-chip"
            title="Model picker is owned by Logic Bot"
          >
            {providerChoices(grokConfigured).find((item) => item.id === providerChoice)?.label ?? "Model"}
          </span>
        }
        onChatSend={(text) => {
          const clipped = text.trim().slice(0, 8000);
          if (!clipped) return;
          if (ws.halted) {
            setError("Emergency stop is on. No new action can run.");
            return;
          }
          if (active) {
            setView("chat");
            void deliver(active, clipped, ws);
            return;
          }
          const made = createChat(ws, {
            memory: memoryChoice,
            autonomy,
            temporary,
            projectId: projectChoice || chatProjectId || null,
          });
          setActiveId(made.chat.id);
          setView("chat");
          setWs((prev) =>
            pushAudit(
              { ...prev, chats: [made.chat, ...prev.chats] },
              "create_chat",
              made.chat.id,
              `ask-anything; memory ${made.chat.memory}`,
            ),
          );
          void deliver(made.chat, clipped, { ...ws, chats: [made.chat, ...ws.chats] });
        }}
        onChatAttachText={(text, name) => {
          setDraft((prev) => (prev ? `${prev}\n\n${text}` : text));
          setNotice(`Attached ${name} into the composer (live was off).`);
        }}
      />
    </div>
  );
}

function Quick({ label, icon: Icon, tone, onClick }: { label: string; icon: typeof Folder; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-panel border border-line bg-surface px-3 text-sm">
      <Icon className={`size-4 ${tone}`} />
      {label}
    </button>
  );
}

function Panel({ title, action, onAction, children }: { title: string; action: string; onAction: () => void; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <button type="button" className="text-sm text-info" onClick={onAction}>{action}</button>
      </div>
      {children}
    </section>
  );
}

function StatusRow({
  icon: Icon,
  name,
  detail,
  pill,
  tone,
}: {
  icon: typeof Database;
  name: string;
  detail: string;
  pill: string;
  tone: "ok" | "danger" | "muted";
}) {
  const color = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-muted";
  return (
    <div className="mt-3 flex items-center gap-3">
      <Icon className="size-4 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      <span className={`rounded-full border border-line px-2 py-1 text-xs ${color}`}>{pill}</span>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-bg/80 p-4 md:place-items-center">
      <div className="w-full max-w-md rounded-panel border border-line bg-surface p-4 shadow-panel">{children}</div>
    </div>
  );
}

function ReaPanel({
  title,
  lead,
  report,
  busy,
  onCheck,
  onInspect,
}: {
  title: string;
  lead: string;
  report: string | null;
  busy: boolean;
  onCheck: () => void;
  onInspect: (() => void) | null;
}) {
  return (
    <section className="p-4 md:p-6">
      <div className="masthead">
        <h2 className="font-display text-3xl font-bold">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">{lead}</p>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_18rem]">
        <div className="glow-card rounded-panel border border-line bg-surface p-4">
          <p className="text-sm font-semibold">What can run</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3 rounded-panel bg-bg px-3 py-2"><span>REA doctor</span><span className="text-xs text-muted">Live check</span></li>
            <li className="flex items-center justify-between gap-3 rounded-panel bg-bg px-3 py-2"><span>REA file inspect</span><span className="text-xs text-muted">Staged text only</span></li>
            <li className="flex items-center justify-between gap-3 rounded-panel bg-bg px-3 py-2"><span>Bounded planner</span><span className="text-xs text-muted">Not running</span></li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={onCheck}>
              {busy ? "Running REA" : "Run REA doctor"}
            </button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm disabled:opacity-50" disabled={!onInspect || busy} onClick={() => onInspect?.()}>
              Inspect staged file
            </button>
          </div>
        </div>
        <p className="glow-card whitespace-pre-wrap rounded-panel border border-line bg-surface p-4 text-sm text-muted">
          {report ?? "No REA report yet. A report appears only after you run doctor or inspect."}
        </p>
      </div>
    </section>
  );
}

function ChatPane({
  active,
  chats,
  projectId,
  projectName,
  onClearProject,
  busy,
  liveText,
  halted,
  draft,
  error,
  setDraft,
  onPick,
  onSend,
  onStop,
  onRename,
  onEdit,
  onRegenerate,
  onRetry,
  onExport,
  onDelete,
  onMemory,
  onSave,
  onNew,
  onSpeak,
  onListen,
  onListenStop,
  onLiveUserTranscript,
  onLiveAssistantTranscript,
  onLiveVoiceError,
  onLiveVoiceNotice,
  speaking,
  voiceMode,
  voiceListening,
  voiceLevel,
  onToggleVoiceMode,
  memoryChoice,
  mode,
  onComposerMemory,
  onComposerMode,
  stagedName,
  onAttach,
  onAnalyze,
  onDoctor,
  providerChoices: choices,
  providerChoice,
  onProvider,
}: {
  active: Chat | null;
  chats: Chat[];
  projectId: string | null;
  projectName: string | null;
  onClearProject: () => void;
  busy: boolean;
  liveText: string;
  halted: boolean;
  draft: string;
  error: string | null;
  setDraft: (value: string) => void;
  onPick: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRename: (title: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onExport: () => void;
  onDelete: () => void;
  onMemory: () => void;
  onSave: (content: string) => void;
  onNew: () => void;
  onSpeak: (text: string) => void;
  onListen: () => void;
  onListenStop?: () => void;
  onLiveUserTranscript?: (text: string) => void;
  onLiveAssistantTranscript?: (text: string) => void;
  onLiveVoiceError?: (message: string) => void;
  onLiveVoiceNotice?: (message: string) => void;
  speaking: boolean;
  voiceMode: VoiceRoutingMode;
  voiceListening: boolean;
  voiceLevel: number;
  onToggleVoiceMode: () => void;
  memoryChoice: "off" | "on";
  mode: Autonomy;
  onComposerMemory: () => void;
  onComposerMode: (mode: Autonomy) => void;
  stagedName: string | null;
  onAttach: () => void;
  onAnalyze: () => void;
  onDoctor: () => void;
  providerChoices: { id: string; label: string; enabled: boolean; reason: string }[];
  providerChoice: string;
  onProvider: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [tools, setTools] = useState(false);
  const [context, setContext] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  useEffect(() => {
    setRenaming(false);
    setEditingId(null);
  }, [active?.id]);
  const needle = filter.trim().toLowerCase();
  const scoped = projectId ? chats.filter((chat) => chat.projectId === projectId) : chats;
  const visible = needle ? scoped.filter((chat) => chat.title.toLowerCase().includes(needle)) : scoped;
  const groups = ["Today", "Yesterday", "This week", "Earlier"]
    .map((label) => ({ label, items: visible.filter((chat) => chatBucket(chat) === label) }))
    .filter((group) => group.items.length > 0);
  const lastReply = [...(active?.messages ?? [])].reverse().find((msg) => msg.role === "assistant");
  return (
    <div className="flex h-full min-h-0 flex-col xl:flex-row">
      <aside className="flex max-h-72 shrink-0 flex-col border-b border-line xl:max-h-none xl:w-64 xl:border-r xl:border-b-0">
        <div className="p-3">
          <button type="button" onClick={onNew} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-panel bg-accent text-sm font-semibold text-accent-ink">
            <Plus className="size-4" /> New Chat
          </button>
        </div>
        <div className="px-3 pb-2">
          {projectName && (
            <p className="mb-2 text-xs text-muted">
              Showing chats for {projectName}.{" "}
              <button type="button" className="text-accent" onClick={onClearProject}>Show all chats</button>
            </p>
          )}
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search conversations" className="min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" aria-label="Search conversations" />
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-3">
          {groups.length === 0 && <p className="text-sm text-muted">{scoped.length === 0 ? (projectName ? `No chats for ${projectName} yet.` : "No conversations yet.") : "No conversations match."}</p>}
          {groups.map((group) => (
            <div key={group.label}>
              <p className="px-1 text-xs text-muted">{group.label}</p>
              {group.items.map((chat) => (
                <button key={chat.id} type="button" onClick={() => onPick(chat.id)} className={`mt-1 flex min-h-11 w-full items-center justify-between rounded-panel px-3 text-left text-sm ${active?.id === chat.id ? "bg-accent text-accent-ink" : ""}`}>
                  <span className="truncate">{chat.title}</span>
                  <span className="ml-2 shrink-0 text-xs opacity-70">{chatStamp(chat)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="masthead px-4 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-3xl font-bold">{active?.title || "AI Chat"}</h2>
            {active && !renaming && (
              <div className="flex gap-3">
                <button type="button" className="min-h-11 text-sm text-accent" onClick={onExport}>Export chat</button>
                <button type="button" className="min-h-11 text-sm text-accent" onClick={() => { setTitleDraft(active.title); setRenaming(true); }}>Rename</button>
              </div>
            )}
          </div>
          {renaming && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onRename(titleDraft);
                setRenaming(false);
              }}
            >
              <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} className="min-h-11 flex-1 rounded-panel border border-line bg-bg px-3 text-sm" aria-label="Chat name" />
              <button type="submit" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink">Save</button>
            </form>
          )}
          <p className="text-sm text-muted">Only a configured provider can be selected. Another provider is not substituted.</p>
          <div className="mt-3 xl:hidden">
            <ProviderPicker name="mind-provider-mobile" choices={choices} choice={providerChoice} onChoose={onProvider} />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {(!active || active.messages.length === 0) && !busy && (
            <div className="grid min-h-64 place-items-center text-center">
              <div>
                <span className="mx-auto grid size-16 place-items-center rounded-full bg-accent/20 text-accent shadow-[0_0_28px_rgb(124_92_255/0.45)]">
                  <Zap className="size-7" />
                </span>
                <p className="mt-4 text-2xl font-bold">Grok 4.5</p>
                <p className="text-sm text-muted">How can I help you today?</p>
                <p className="mt-1 text-xs text-muted">Nothing is sent until you press Send.</p>
              </div>
            </div>
          )}
          {active?.messages.map((msg) => {
            const last = active.messages.at(-1);
            return (
            <article key={msg.id} className={`max-w-3xl rounded-panel border border-line px-3 py-2 text-sm ${msg.role === "user" ? "ml-auto bg-surface-2" : "bg-surface"}`}>
              <p className="mb-1 text-xs text-muted">{msg.role === "user" ? "You" : msg.model || "Grok 4.5"} · {stamp(msg.at)}</p>
              {editingId === msg.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onEdit(msg.id, editDraft);
                    setEditingId(null);
                  }}
                >
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} className="w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
                  <p className="mt-1 text-xs text-muted">Saving replaces this message and removes every reply after it, then sends it again.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="submit" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink">Save and send</button>
                    <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <MessageBody text={msg.content} />
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="min-h-11 text-xs text-accent"
                  onClick={() => {
                    void navigator.clipboard?.writeText(msg.content).then(() => {
                      setCopiedId(msg.id);
                    }).catch(() => setCopiedId(null));
                  }}
                >
                  {copiedId === msg.id ? "Copied" : "Copy"}
                </button>
                {msg.role === "assistant" && (
                  <button type="button" className="min-h-11 text-xs text-accent" onClick={() => onSpeak(msg.content)} disabled={speaking}>
                    {speaking ? "Speaking" : "Speak"}
                  </button>
                )}
                {msg.role === "assistant" && last?.id === msg.id && (
                  <button type="button" className="min-h-11 text-xs text-accent" onClick={onRegenerate} disabled={busy || halted}>Regenerate</button>
                )}
                {msg.role === "user" && (
                  <button
                    type="button"
                    className="min-h-11 text-xs text-accent"
                    disabled={busy || halted}
                    onClick={() => {
                      setEditingId(msg.id);
                      setEditDraft(msg.content);
                    }}
                  >
                    Edit
                  </button>
                )}
                {msg.role === "user" && active.memory === "on" && (
                  <button type="button" className="min-h-11 text-xs text-accent" onClick={() => onSave(msg.content)}>Save as chat memory</button>
                )}
              </div>
            </article>
            );
          })}
          {busy && liveText && (
            <article className="max-w-3xl rounded-panel border border-line bg-surface px-3 py-2 text-sm">
              <p className="mb-1 text-xs text-muted">Grok 4.5 · writing</p>
              <p className="whitespace-pre-wrap">{liveText}</p>
            </article>
          )}
          {busy && !liveText && <p className="text-sm text-muted">Waiting for Grok.</p>}
          {busy && (
            <button type="button" className="min-h-11 text-sm text-danger" onClick={onStop}>Stop this reply</button>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          {error && active?.messages.at(-1)?.role === "user" && (
            <button type="button" className="min-h-11 text-sm text-accent" disabled={busy || halted} onClick={onRetry}>Retry</button>
          )}
          {active && <p className="text-xs text-muted">Chat memory is {active.memory === "on" ? "on" : "off"} for this session. The agent session is on this device. Hosted realtime is not connected. The schedule worker is separate.</p>}
          <div className="flex items-center gap-2"><VoiceLevelMeter level={voiceLevel} listening={voiceListening} /><VoiceModeBadge mode={voiceMode} listening={voiceListening} onToggle={onToggleVoiceMode} /></div>
        </div>
        <form
          className="command-card m-3 rounded-panel bg-surface p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message Grok 4.5..." className="min-h-11 w-full bg-transparent text-sm outline-none" />
          {stagedName && <p className="text-xs text-muted">Staged: {stagedName}. Send includes it. Analyze runs REA on it.</p>}
          {context && (
            <p className="mt-2 text-xs text-muted">
              Memory is {memoryChoice}. {memoryChoice === "off" ? "This chat cannot read or save notes." : "This chat can read notes in its scope."} Mode is {mode === "ask" ? "Ask" : "Automatic"}. Deletes still ask you.
            </p>
          )}
          {tools && (
            <div className="mt-2 space-y-1 rounded-panel border border-line bg-bg p-3 text-sm">
              <button type="button" className="block min-h-11 text-left text-accent" onClick={onDoctor}>Run REA doctor</button>
              <button type="button" className="block min-h-11 text-left text-accent" onClick={onAnalyze}>Inspect a file with REA</button>
              <p className="text-xs text-muted">Chat stays on Grok 4.5. Image, video, and web search are not called.</p>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={onAttach}>
              <Paperclip className="size-4" /> Attach
            </button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setContext((open) => !open); setTools(false); }}>Add Context</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setTools((open) => !open); setContext(false); }}>Tools</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onDelete} disabled={!active}>Delete</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onMemory} disabled={!active}>{memoryChoice === "on" ? "Memory on" : "Memory off"}</button>
            <VoiceLevelMeter level={voiceLevel} listening={voiceListening} />
            <button type="button" title={voiceMicAriaLabel(voiceListening)} className={`ml-auto grid size-11 place-items-center rounded-panel border border-line ${voiceListening ? "bg-accent text-accent-ink" : ""}`} onClick={onListen} aria-label={voiceMicAriaLabel(voiceListening)} aria-keyshortcuts={VOICE_TOGGLE_SHORTCUT.ariaKeyshortcuts} aria-pressed={voiceListening}>
              {voiceListening ? <Square className="size-4" /> : <Mic className="size-4" />}
            </button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={!lastReply || speaking} onClick={() => lastReply && onSpeak(lastReply.content)}>
              {speaking ? "Speaking" : "Speak"}
            </button>
            <button type="submit" disabled={busy || halted || !active} className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">Send</button>
          </div>
        </form>
      </section>
      <aside className="hidden w-72 shrink-0 flex-col gap-3 border-l border-line p-3 xl:flex">
        <section className="rounded-panel border border-line bg-surface p-3">
          <ProviderPicker name="mind-provider-side" choices={choices} choice={providerChoice} onChoose={onProvider} />
        </section>
        <section className="rounded-panel border border-line bg-surface p-3">
          <button type="button" onClick={() => onComposerMode("ask")} className={`mb-2 min-h-11 w-full rounded-panel px-3 text-left text-sm ${mode === "ask" ? "bg-accent text-accent-ink" : "bg-surface-2"}`}>Ask</button>
          <button type="button" onClick={() => onComposerMode("automatic")} className={`min-h-11 w-full rounded-panel px-3 text-left text-sm ${mode === "automatic" ? "bg-accent text-accent-ink" : "bg-surface-2"}`}>Automatic</button>
        </section>
        <section className="rounded-panel border border-line bg-surface p-3">
          <button type="button" role="switch" aria-checked={memoryChoice === "on"} onClick={onComposerMemory} className="flex min-h-11 w-full items-center justify-between text-sm">
            Memory: {memoryChoice === "on" ? "ON" : "OFF"}
            <span className={`h-6 w-11 rounded-full ${memoryChoice === "on" ? "bg-accent" : "bg-line"}`} />
          </button>
          <p className="mt-2 text-xs text-muted">Off means this chat cannot read or save notes.</p>
        </section>
        <section className="rounded-panel border border-line bg-surface p-3 text-sm">
          <p className="font-semibold">{active?.title ?? "New session"}</p>
          <p className="text-xs text-muted">On this device · Memory {memoryChoice}</p>
        </section>
      </aside>
    </div>
  );
}

function ProviderPicker({
  name,
  choices,
  choice,
  onChoose,
}: {
  name: string;
  choices: { id: string; label: string; enabled: boolean; reason: string }[];
  choice: string;
  onChoose: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Model</legend>
      {choices.map((item) => (
        <label key={item.id} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            className="mt-1"
            checked={choice === item.id}
            disabled={!item.enabled}
            onChange={() => {
              if (item.enabled) onChoose(item.id);
            }}
          />
          <span>
            {item.label}
            {item.id === "grok" && item.enabled ? <span className="text-muted"> · Configured, not live verified</span> : null}
            <span className="block text-xs text-muted">{item.reason}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function chatBucket(chat: Chat) {
  const iso = chat.messages[0]?.at;
  if (!iso) return "Today";
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const diff = (start.getTime() - day.getTime()) / 86_400_000;
  if (diff < 1) return "Today";
  if (diff < 2) return "Yesterday";
  if (diff < 7) return "This week";
  return "Earlier";
}

function chatStamp(chat: Chat) {
  const iso = chat.messages.at(-1)?.at ?? chat.messages[0]?.at;
  if (!iso) return "New";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
