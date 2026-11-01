import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  ChevronDown,
  CircleHelp,
  Link2,
  ListTree,
  Menu,
  PanelLeft,
  Pin,
  Terminal,
  Volume2,
  Wrench,
  Zap,
} from "lucide-react";
import { approvalTokenFor, decide, type Autonomy } from "@/lib/mind/policy";
import { reaDoctor, reaInspect } from "@/lib/mind/rea";
import { CAPABILITIES, isVerifiedCapability, type CapabilityStatus } from "@/lib/mind/registry";
import { REQUIREMENTS, requirementCounts } from "@/lib/mind/requirements";
import { consumeMindTurn, shouldStoreReply } from "@/lib/mind/live-turn";
import { analyzeImageFile, mcpCommand, mcpList, mcpRemove, mcpSave, mindStatus, notionCommand, notionDisconnect, notionStatus, recordAgentExecution, searchWeb, setExecutionHalt, speakText } from "@/lib/mind/server";
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
import { MODEL_TIERS, type ModelTier } from "@/lib/mind/model-tiers";
import { chosenProvider, failover, providerChoices } from "@/lib/mind/providers";
import { runSkill, searchSkills, SKILLS } from "@/lib/mind/skills";
import { exportChat, prepareRegenerate, prepareRetry, renameChat, reviseUserTurn } from "@/lib/mind/transcript";
import { useMindWorkspace } from "@/lib/mind/use-mind-workspace";
import {
  classifyHonestFailure,
  honestFailureAuditAction,
  HONEST_FAILURE_MESSAGES,
} from "@/lib/mind/failure-states";
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

const MODEL_TIERS = ["Auto", "Fast", "Expert", "Heavy", "Build"] as const;
type ModelTier = (typeof MODEL_TIERS)[number];

const NAV_ICON_SRC: Partial<Record<View, string>> = {
  command: "/icons/chat.svg",
  agents: "/icons/bots.svg",
  build: "/icons/build.svg",
  projects: "/icons/projects.svg",
  research: "/icons/research.svg",
  files: "/icons/library.svg",
  chat: "/icons/thread.svg",
  runs: "/icons/runs.svg",
  connected: "/icons/systems.svg",
  tools: "/icons/systems.svg",
  scheduled: "/icons/systems.svg",
  skills: "/icons/systems.svg",
  memory: "/icons/library.svg",
  activity: "/icons/runs.svg",
  settings: "/icons/systems.svg",
  help: "/icons/systems.svg",
  integrations: "/icons/systems.svg",
};


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
    chat_failed: "Chat failed",
    open_page_failed: "Open page failed",
    research_failed: "Research failed",
    model_unavailable: "Model unavailable",
    database_write_failed: "Database write failed",
    emergency_stop_active: "Emergency stop blocked an action",
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
  const turnGen = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; auditId: string; retry: (() => void) | null } | null>(null);
  const [focusAuditId, setFocusAuditId] = useState<string | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const [grok, setGrok] = useState("Checking");
  const [databasePill, setDatabasePill] = useState("Checking");
  const [databaseDetail, setDatabaseDetail] = useState("The status check has not finished.");
  const [grokConfigured, setGrokConfigured] = useState<boolean | null>(null);
  const [providerChoice, setProviderChoice] = useState("grok");
  const [modelTier, setModelTier] = useState<ModelTier>("Auto");
  const [failoverPolicy, setFailoverPolicy] = useState<"none" | "grok">("none");
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
  const [listening, setListening] = useState(false);
  const [modelTier, setModelTier] = useState<ModelTier>("Auto");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
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
    if (!focusAuditId || view !== "activity") return;
    const node = document.getElementById(`audit-${focusAuditId}`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusAuditId, view, ws.audit]);

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
      const tier = localStorage.getItem("amcos.modelTier.v1");
      if (tier && (MODEL_TIERS as readonly string[]).includes(tier)) setModelTier(tier as ModelTier);
      const fail = localStorage.getItem("amcos.failover.v1");
      if (fail === "grok" || fail === "none") setFailoverPolicy(fail);
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
    try {
      localStorage.setItem("amcos.modelTier.v1", modelTier);
      localStorage.setItem("amcos.failover.v1", failoverPolicy);
    } catch {
      /* a private browser can refuse storage */
    }
  }, [modelTier, failoverPolicy]);

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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      setModelMenuOpen(false);
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

  async function deliver(chat: Chat, text: string, source: Workspace, resume = false) {
    const latest = wsRef.current;
    if (latest.halted || source.halted) {
      reportEmergencyStop(chat.id, () => {
        void deliver(chat, text, wsRef.current, resume);
      });
      return;
    }
    let routed = chosenProvider(providerChoice, grokConfigured);
    if (!routed.ok) {
      const switched = failover(providerChoice, grokConfigured === true, failoverPolicy);
      if (switched.provider === "grok") {
        routed = chosenProvider("grok", grokConfigured);
        if (routed.ok) setNotice(switched.note);
      }
    }
    if (!routed.ok) {
      reportFailure(routed.error, "model_unavailable", "provider", () => {
        void deliver(chat, text, wsRef.current, resume);
      });
      return;
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
    setFailure(null);
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
          halted: wsRef.current.halted,
          history,
          memoryContext: memoriesForChat(source, chat).map((item) => ({ id: item.id, text: item.text })),
          provider: routed.id,
          modelTier,
        },
        onDelta: (chunk) => {
          if (generation !== turnGen.current) return;
          setLiveText((current) => current + chunk);
        },
      });
      if (generation !== turnGen.current) return;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      if (!shouldStoreReply(result)) {
        const message = result.ok ? "Grok returned an empty reply." : result.error;
        const kind = classifyHonestFailure(message);
        reportFailure(message, kind === "emergency_stop_active" ? "emergency_stop_active" : kind === "model_unavailable" ? "model_unavailable" : "chat_failed", chat.id, () => {
          void deliver(chat, text, wsRef.current, true);
        });
        return;
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
        const autoBit =
          result.resolvedTier && (result.modelTier === "Auto" || (!result.modelTier && modelTier === "Auto"))
            ? `→${result.resolvedTier}`
            : "";
        const tierLabel = result.model
          ? `${result.model}${result.resolvedTier || result.modelTier ? ` (${result.modelTier ?? modelTier}${autoBit})` : ""}`
          : result.model;
        setNotice(`Ran ${tierLabel}.`);
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
          tierLabel,
        );
      });
    } catch (caught) {
      if (generation !== turnGen.current) return;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      const message =
        caught instanceof Error && caught.message === "Unauthorized"
          ? "Sign in is required."
          : caught instanceof Error
            ? caught.message
            : HONEST_FAILURE_MESSAGES.model_unreachable;
      const kind = classifyHonestFailure(message);
      reportFailure(message, kind === "emergency_stop_active" ? "emergency_stop_active" : kind === "model_unavailable" ? "model_unavailable" : "chat_failed", chat.id, () => {
        void deliver(chat, text, wsRef.current, resume);
      });
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
    if (!active || busy) return;
    if (wsRef.current.halted) {
      reportEmergencyStop(active.id, () => editMessage(messageId, text));
      return;
    }
    const revised = reviseUserTurn(ws, active.id, messageId, text);
    if ("error" in revised) {
      setError(revised.error);
      return;
    }
    setWs(revised.ws);
    void deliver(revised.chat, revised.text, revised.ws, true);
  }

  function regenerate() {
    if (!active || busy) return;
    if (wsRef.current.halted) {
      reportEmergencyStop(active.id, () => regenerate());
      return;
    }
    const prepared = prepareRegenerate(ws, active.id);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setWs(prepared.ws);
    void deliver(prepared.chat, prepared.text, prepared.ws, true);
  }

  function retryLast() {
    if (!active || busy) return;
    if (wsRef.current.halted) {
      reportEmergencyStop(active.id, () => retryLast());
      return;
    }
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
    if (busy) return;
    const text = draft.trim();
    if (!text) {
      setError("Write what you want to work on.");
      return;
    }
    if (wsRef.current.halted) {
      const snapshot = text;
      const file = staged;
      reportEmergencyStop("command", () => {
        setDraft(snapshot);
        if (file) setStaged(file);
        void sendCommand();
      });
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
    if (wsRef.current.halted) {
      const query = researchText;
      reportEmergencyStop("search", () => {
        setResearchText(query);
        void startResearch();
      });
      return;
    }
    setResearchCitations([]);
    const query = researchText;
    try {
      const result = await searchWeb({ data: { query } });
      setError(null);
      setResearchCitations(result.citations);
      setResearchNote(result.ok ? "" : result.error);
      setWs((prev) => pushAudit(prev, result.configured && result.ok ? "research_result" : "research_refused", "search", result.ok ? `${result.citations.length} sources` : "no citation"));
      if (!result.ok) {
        reportFailure(result.error || "Research refused. No citations were created.", "research_failed", "search", () => {
          setResearchText(query);
          void startResearch();
        });
      } else {
        clearFailure();
      }
    } catch (caught) {
      setResearchCitations([]);
      const message = caught instanceof Error ? caught.message : "The search did not run. No citations were created.";
      setResearchNote(message);
      reportFailure(message, "research_failed", "search", () => {
        setResearchText(query);
        void startResearch();
      });
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
          modelTier,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        text?: string;
        error?: string;
        log?: { step: number; tool: string; ok: boolean; detail: string }[];
        model?: string;
        modelTier?: string;
        resolvedTier?: string;
      };
      if (controller.signal.aborted) return;
      setAgentLog(payload.log ?? []);
      const modelBit = payload.model ? ` Model ${payload.model}${payload.resolvedTier ? ` (${payload.modelTier ?? modelTier}→${payload.resolvedTier})` : ""}.` : "";
      setAgentNote((payload.ok ? payload.text ?? "" : payload.error || "The planner did not finish.") + (payload.ok ? modelBit : ""));
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
    if (!active || busy) return;
    const text = draft.trim();
    if (!text && !staged) return;
    if (wsRef.current.halted) {
      const snapshot = text;
      const file = staged;
      const chatId = active.id;
      reportEmergencyStop(chatId, () => {
        setDraft(snapshot);
        if (file) setStaged(file);
        void sendInChat();
      });
      return;
    }
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

  function clearFailure() {
    setFailure(null);
    setError(null);
  }

  function reportFailure(message: string, action: string, target: string, retry: (() => void) | null) {
    const kind = classifyHonestFailure(message);
    const auditAction = kind ? honestFailureAuditAction(kind) : action;
    const auditId = crypto.randomUUID();
    setWs((prev) => ({
      ...prev,
      audit: [{ id: auditId, at: new Date().toISOString(), action: auditAction, target, result: message }, ...prev.audit].slice(0, 200),
    }));
    setFailure({ message, auditId, retry });
    setError(message);
    setNotice(null);
  }

  function reportEmergencyStop(target: string, retry: () => void) {
    reportFailure(HONEST_FAILURE_MESSAGES.emergency_stop_active, "emergency_stop_active", target, retry);
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
    setSpeaking(true);
    setError(null);
    const result = await speakText({ data: { text } });
    setSpeaking(false);
    if (!result.ok) {
      if (!result.error.includes("No speech key")) {
        setError(result.error);
        return;
      }
      const synth = window.speechSynthesis;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        setError(`${result.error} This browser has no speech synthesis. Nothing was spoken.`);
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => setSpeaking(false);
      utter.onerror = () => {
        setSpeaking(false);
        setError("Browser speech failed. Nothing was spoken.");
      };
      setSpeaking(true);
      synth.cancel();
      synth.speak(utter);
      setNotice("Speaking with this browser. This is not a realtime voice provider, and no speech key was used.");
      return;
    }
    const binary = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([binary], { type: result.mime }));
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play().catch(() => setError("The browser blocked playback."));
  }

  function listen() {
    setListening(true);
    window.setTimeout(() => setListening(false), 6000);
    const host = window as Window & {
      SpeechRecognition?: new () => {
        lang: string;
        start: () => void;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        start: () => void;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      };
    };
    const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Ctor) {
      setNotice("This browser has no speech recognition. Nothing was transcribed. This is not a realtime voice provider.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (event) => {
      setListening(false);
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setDraft(transcript);
      voiceNext.current = Boolean(transcript);
      setNotice(transcript ? "The transcript is in the message box. Send uses the same agent. This is browser speech, not a realtime voice provider." : "No words were recognized. Nothing was sent.");
    };
    rec.start();
  }

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
    <div className="shell flex h-dvh flex-col bg-bg text-fg md:flex-row">
      <aside className={`rail ${navOpen ? "flex" : "hidden"} fixed inset-0 z-40 w-full flex-col md:static md:flex md:h-dvh ${railCollapsed ? "md:w-[4.5rem]" : "md:w-72"} md:shrink-0`}>
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="logo-badge grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl">
            <img src="/brand/logo-mark.jpg" alt="" className="size-11 object-cover" />
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
        <div className={`px-3 pb-2 ${railCollapsed ? "flex justify-center" : ""}`}>
          <button
            type="button"
            className={`nav-item flex min-h-11 items-center gap-3 rounded-2xl border border-line/70 bg-surface-2/40 px-3 text-sm text-muted ${railCollapsed ? "size-11 justify-center px-0" : "w-full"}`}
            aria-label="Search workspace"
            onClick={() => {
              setPaletteOpen(true);
              setNavOpen(false);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            <Search className="size-4 shrink-0" />
            {!railCollapsed && <span>Search</span>}
          </button>
        </div>
        <nav className="flex-1 overflow-auto px-3 pb-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              {!railCollapsed && <p className="meta-label px-3 pb-2">{group.label}</p>}
              <div className="space-y-1">
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
                    className={`nav-item flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium ${on ? "nav-item-active" : "text-muted hover:bg-white/5"}`}
                  >
                    {NAV_ICON_SRC[item.id] ? <img src={NAV_ICON_SRC[item.id]} alt="" className="nav-icon-img" /> : <Icon className="size-4 shrink-0 opacity-90" />}
                    {!railCollapsed && item.label}
                  </button>
                );
              })}
              </div>
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
        <div className={`border-t border-line/70 p-3 ${railCollapsed ? "flex flex-col items-center gap-2" : ""}`}>
          <button
            type="button"
            className={`sidebar-plus inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-accent px-3 text-sm font-semibold text-accent-ink ${railCollapsed ? "size-11 px-0" : "w-full"}`}
            aria-label="New chat"
            onClick={() => {
              openChat();
              setView("chat");
              setNavOpen(false);
            }}
          >
            <Plus className="size-4" />
            {!railCollapsed && "New"}
          </button>
          {!railCollapsed && (
            <div className="mt-3">
              <p className="text-sm font-semibold">Adrian (Personal)</p>
              <p className="text-xs text-muted">Only workspace on this device.</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-glow" style={{ width: `${Math.min(100, (storedBytes / 5_000_000) * 100)}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">Storage · {formatBytes(storedBytes)} in this browser</p>
              <p className="text-xs text-muted">Not a cloud quota. Pins stay in this browser copy.</p>
            </div>
          )}
        </div>
      </aside>

      <div className="main-stage page-enter flex min-h-0 min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="topbar flex items-center gap-2 px-3 py-3 md:gap-3 md:px-5">
          <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel border border-line md:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Menu className="size-4" />
          </button>
          <p className="hidden text-sm font-semibold md:block">{TITLES[view]}</p>
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
              className="input-glow h-11 w-full rounded-panel border border-line bg-surface/80 pr-14 pl-10 text-sm backdrop-blur"
              aria-label="Search"
              aria-keyshortcuts="Control+K Meta+K"
              aria-expanded={paletteOpen}
              aria-controls="command-palette"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">⌘K</span>
            {paletteOpen && (
              <div id="command-palette" className="floating-menu absolute z-30 mt-2 max-h-80 w-full overflow-auto p-2">
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
          <span className={`hidden h-11 items-center gap-2 rounded-full border px-3 text-sm md:inline-flex glass-panel ${headerTone}`}>
            <span className="size-2 rounded-full bg-current" />
            {headerState}
          </span>
          <div className="relative hidden md:block">
            <button
              type="button"
              className="model-chip inline-flex h-11 items-center gap-2 px-3 text-sm font-medium"
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
              onClick={() => {
                setModelMenuOpen((open) => !open);
                setBellOpen(false);
                setAccountOpen(false);
              }}
            >
              {modelTier}
              <ChevronDown className="size-3.5 opacity-70" />
            </button>
            {modelMenuOpen && (
              <div className="floating-menu absolute right-0 z-40 mt-2 w-56 p-2" role="menu">
                <p className="px-2 pb-2 text-[10px] font-semibold tracking-[0.16em] text-muted">MODEL</p>
                {MODEL_TIERS.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    role="menuitemradio"
                    aria-checked={modelTier === tier}
                    className={`flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm ${modelTier === tier ? "model-option-active" : "text-muted hover:bg-white/5"}`}
                    onClick={() => {
                      setModelTier(tier);
                      setModelMenuOpen(false);
                    }}
                  >
                    {tier}
                  </button>
                ))}
                <p className="mt-2 border-t border-line/60 px-2 pt-2 text-[11px] text-muted">Display preference only. Send still uses the configured provider rules.</p>
              </div>
            )}
          </div>
          <div className={`voice-zone ${listening || speaking ? "is-live" : ""}`} aria-label="Voice controls">
            <button
              type="button"
              className={`focus-ring grid size-9 place-items-center rounded-full ${listening ? "mic-pulse text-glow" : "text-muted"}`}
              aria-label="Dictate"
              onClick={() => listen()}
            >
              <Mic className="size-4" />
            </button>
            <span className="waveform" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span />
            </span>
            <button
              type="button"
              className="focus-ring grid size-9 place-items-center rounded-full text-muted"
              aria-label="Speak last reply"
              disabled={speaking}
              onClick={() => {
                const last = [...(active?.messages ?? [])].reverse().find((msg) => msg.role === "assistant");
                if (last) void speak(last.content);
              }}
            >
              <Volume2 className="size-4" />
            </button>
          </div>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full border border-line bg-white/5"
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
          <div className="banner-error mx-3 mt-2 flex flex-wrap items-center justify-between gap-2 px-4 py-2 md:mx-5">
            <p className="text-sm text-danger">Emergency stop is on. Sending and approvals are blocked.</p>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => void toggleStop()}>
              Clear stop
            </button>
          </div>
        )}
        {(failure || error) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2" role="alert" data-testid="failure-banner">
            <p className="text-sm text-danger">{failure?.message ?? error}</p>
            <div className="flex flex-wrap gap-2">
              {failure?.retry ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
                  onClick={() => {
                    const retry = failure.retry;
                    clearFailure();
                    retry?.();
                  }}
                >
                  Retry
                </button>
              ) : null}
              {failure?.auditId ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-4 text-sm text-danger"
                  onClick={() => {
                    setView("activity");
                    setFocusAuditId(failure.auditId);
                    setActivityQuery("");
                    setNavOpen(false);
                  }}
                >
                  View log
                </button>
              ) : null}
              <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm" onClick={() => clearFailure()}>
                Dismiss
              </button>
            </div>
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

              <section className="floating-composer command-card p-3 md:p-4">
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <button type="button" onClick={() => setAutonomy("ask")} className={`min-h-16 rounded-panel px-4 text-left ${autonomy === "ask" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80 text-muted"}`}>
                    <span className="block text-sm font-bold">ASK</span>
                    <span className="block text-xs">Review and approve before action</span>
                  </button>
                  <button type="button" onClick={() => setAutonomy("automatic")} className={`min-h-16 rounded-panel px-4 text-left ${autonomy === "automatic" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80 text-muted"}`}>
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
                        className={`min-h-11 rounded-full px-3 text-sm ${commandMode === id ? "bg-accent text-accent-ink tile-active" : "border border-line/80 bg-white/5 text-muted"}`}
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
                    className="input-glow w-full resize-none rounded-[1.1rem] border border-line/80 bg-bg/70 px-3 py-3 text-sm"
                  />
                  {staged && (
                    <p className="mt-2 text-xs text-muted">Staged: {staged.name}. It stays in this browser and is sent only if you press Send.</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line bg-white/5 px-3 text-sm" onClick={() => fileRef.current?.click()}>
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
                    <button type="submit" disabled={busy || ws.halted} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
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

              <div className="flex flex-wrap gap-2 pb-1">
                <button type="button" className="suggestion-chip" onClick={() => setDraft("Summarize my projects on this device")}>Summarize my projects</button>
                <button type="button" className="suggestion-chip" onClick={() => setDraft("What can Run worker do right now?")}>What can the worker do?</button>
                <button type="button" className="suggestion-chip" onClick={() => setView("connected")}>Review connected services</button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <Quick label="Create Project" icon={Folder} tone="text-accent" onClick={() => setProjectOpen(true)} />
                <Quick label="Run Agent" icon={Bot} tone="text-info" onClick={() => { setView("agents"); void checkRea(); }} />
                <Quick label="Research" icon={Search} tone="text-ok" onClick={() => { setView("research"); if (staged) void inspectWithRea(staged, "research"); else void checkRea(); }} />
                <Quick label="Generate Image" icon={Image} tone="text-warn" onClick={() => explain("Image generation is a paid API and is not called from this app.")} />
                <Quick label="Generate Video" icon={Video} tone="text-accent" onClick={() => explain("Video generation is a paid API and is not called from this app.")} />
                <Quick label="Analyze File" icon={FileText} tone="text-info" onClick={() => { if (staged) void inspectWithRea(staged, "research"); else { inspectNext.current = "research"; fileRef.current?.click(); } }} />
                <Quick label="More Tools" icon={Wrench} tone="text-muted" onClick={() => setToolsOpen(true)} />
              </div>
              {notice && <p className="banner-notice px-3 py-2 text-sm text-muted">{notice}</p>}
              {error && <p className="banner-error px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
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
              onListen={listen}
              speaking={speaking}
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
              modelTier={modelTier}
              onModelTier={setModelTier}
            />
          )}

          {view === "projects" && (
            <section className="page-shell">
              <div className="page-hero mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src="/icons/projects.svg" alt="" className="size-10" />
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
                  <article className="empty-state lg:col-span-2">
                    <img src="/empty/empty-folder.svg" alt="" />
                    <p className="font-semibold">No projects on this device yet.</p>
                    <p className="text-sm text-muted">Create one to keep its chats, notes, and files apart. Progress, tasks, and cloud files are not invented.</p>
                  </article>
                )}
                {ws.projects.map((project) => {
                  const chats = ws.chats.filter((chat) => chat.projectId === project.id).length;
                  const notes = ws.memories.filter((item) => item.projectId === project.id && !item.archived).length;
                  const files = ws.files.filter((file) => file.projectId === project.id).length;
                  return (
                    <article key={project.id} className="dense-card card-texture p-4">
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
            <section className="page-shell">
              <div className="page-hero mb-4 flex items-center gap-3"><img src="/icons/systems.svg" alt="" className="size-8" /><div><h2 className="font-display text-3xl font-bold">Connected</h2><p className="text-sm text-muted">Setup explains what is missing. A service is connected only after the server says so.</p></div></div>
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
          {view === "tools" && <FleetPanel mode="tools" ws={ws} setWs={setWs} onFailure={(message, retry) => reportFailure(message, "open_page_failed", "browser", retry)} />}
          {view === "build" && (
            <section className="page-shell space-y-4">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/icons/build.svg" alt="" className="size-8" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Build</h2>
                    <p className="text-sm text-muted">This page does not edit the repository, run a terminal, install packages, or create commits. A paired computer is required before any of that can run.</p>
                  </div>
                </div>
              </div>
              <div className="promo-banner text-sm">
                <img src="/empty/empty-folder.svg" alt="" className="h-14 w-20" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Local Companion not paired</p>
                  <p className="text-muted">Pair a computer to unlock file edits, tests, and git. Nothing runs until then.</p>
                </div>
              </div>
              <ul className="dense-grid space-y-0 text-sm">
                <li className="dense-card dense-row">Read this workspace’s projects, chats, and notes. Available from Ask: “show my projects”.</li>
                <li className="dense-card dense-row">Edit files, run tests, and use git. Not available. No files were changed.</li>
                <li className="dense-card dense-row">HP EliteBook and iPhone control. Not paired.</li>
              </ul>
            </section>
          )}
          {view === "research" && (
            <section className="page-shell">
              <div className="page-hero card-texture">
                <div className="flex items-center gap-3">
                  <img src="/icons/research.svg" alt="" className="size-8" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Research</h2>
                    <p className="text-sm text-muted">A search runs only when the server has a search endpoint and key. Otherwise this refuses, does not call Grok, and creates no citations. Links appear only when the provider returned them.</p>
                  </div>
                </div>
                <textarea value={researchText} onChange={(event) => setResearchText(event.target.value)} placeholder="What do you want to research?" rows={3} className="input-glow mt-3 w-full rounded-panel border border-line bg-bg/70 px-3 py-2 text-sm" />
                <button type="button" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={ws.halted} onClick={startResearch}>
                  Check research
                </button>
                {researchNote ? <p className="mt-3 text-sm text-muted">{researchNote}</p> : null}
                {researchCitations.length === 0 && !researchNote ? (
                  <div className="empty-state mt-4">
                    <img src="/empty/empty-search.svg" alt="" />
                    <p className="font-semibold">No citations yet</p>
                    <p className="text-sm text-muted">Run a check when a search provider is configured.</p>
                  </div>
                ) : null}
                {researchCitations.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {researchCitations.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => (
                      <li key={item.url} className="dense-row">
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
            <section className="page-shell space-y-4">
              <div className="page-hero"><h2 className="font-display text-3xl font-bold">Skills</h2>
              <p className="text-sm text-muted">Built-in skills read this device. Not installed means the outside service is not connected. Nothing is marked installed unless it can run.</p></div>
              <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="Search skills" className="min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
              <div className="grid gap-3 md:grid-cols-2">
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).map((skill) => {
                  const on = skill.kind === "built-in" && enabledSkills[skill.id] !== false;
                  return (
                    <article key={skill.id} className="dense-card p-3">
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
            <section className="page-shell">
              <div className="page-hero mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src="/icons/library.svg" alt="" className="size-8" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Library</h2>
                    <p className="text-sm text-muted">Text, markdown, CSV, and JSON are read as text. PDF and images are stored only. They are not decoded.</p>
                  </div>
                </div>
                <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => fileRef.current?.click()}>Upload text</button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[16rem_1fr]">
                <aside className="dense-card card-texture p-3 text-sm">
                  <p className="font-semibold">Text copies</p>
                  <p className="mt-2 text-xs text-muted">These are the words you attached, not the original file and not a cloud drive.</p>
                  <ul className="mt-3 space-y-1">
                    {ws.files.length === 0 && (
                      <li className="empty-state py-6">
                        <img src="/empty/empty-folder.svg" alt="" />
                        <p className="text-muted">No files yet.</p>
                      </li>
                    )}
                    {ws.files.map((file) => (
                      <li key={file.id}>
                        <button type="button" onClick={() => setOpenFileId(file.id)} className={`dense-row min-h-11 w-full px-2 text-left ${openFileId === file.id ? "tile-active bg-accent text-accent-ink" : ""}`}>
                          {file.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
                <div className="dense-card p-4 text-sm">
                  {!ws.files.find((file) => file.id === openFileId) && (
                    <div className="empty-state">
                      <img src="/empty/empty-folder.svg" alt="" />
                      <p className="font-semibold">Select a file</p>
                      <p className="text-muted">Upload text from the button above, or attach a file on Command.</p>
                    </div>
                  )}
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
            <section className="page-shell">
              <div className="page-hero">
                <h2 className="font-display text-3xl font-bold">Integrations</h2>
                <p className="text-sm text-muted">{system}</p>
                <p className="text-xs text-muted">Last check {stamp(checkedAt) || checkedAt}. Green means that behavior was verified here. Configured means a key or setting exists and a live call was not verified.</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {CAPABILITIES.map((item) => {
                  const live = isVerifiedCapability(item.status);
                  return (
                    <article key={item.id} className="dense-card card-texture p-4">
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
            <section className="page-shell">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/icons/runs.svg" alt="" className="size-8" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Activity</h2>
                    <p className="text-sm text-muted">Only actions this app actually recorded. Nothing is filled in to look busy.</p>
                  </div>
                </div>
              </div>
              <input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Filter activity" className="input-glow mt-4 min-h-11 w-full rounded-panel border border-line bg-surface/80 px-3 text-sm" aria-label="Filter activity" />
              <ul className="mt-4 space-y-2">
                {ws.audit.length === 0 && (
                  <li className="empty-state">
                    <img src="/empty/empty-activity.svg" alt="" />
                    <p className="font-semibold">No events yet</p>
                    <p className="text-sm text-muted">Actions you take will appear here.</p>
                  </li>
                )}
                {ws.audit.filter((entry) => `${humanAction(entry.action)} ${entry.result}`.toLowerCase().includes(activityQuery.trim().toLowerCase())).length === 0 && ws.audit.length > 0 && (
                  <li className="text-sm text-muted">No events match that filter.</li>
                )}
                {ws.audit.filter((entry) => `${humanAction(entry.action)} ${entry.result}`.toLowerCase().includes(activityQuery.trim().toLowerCase())).map((entry) => (
                  <li
                    key={entry.id}
                    id={`audit-${entry.id}`}
                    className={`dense-card dense-row flex-wrap justify-between text-sm ${focusAuditId === entry.id ? "border-danger bg-danger/10" : ""}`}
                  >
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
                <li className="dense-card p-3"><span className="font-semibold">Chat.</span> Ask sends a normal question to Grok when you press Send. Notion is called only when the server has a token. Gmail, search, image, video, and the computer are refused.</li>
                <li className="dense-card p-3"><span className="font-semibold">Bots & Agents.</span> Templates and custom bots are saved on this device. Run worker once on the Runs screen. Nothing runs in the background.</li>
                <li className="dense-card p-3"><span className="font-semibold">Build.</span> No repository is edited and no terminal runs until a computer is paired.</li>
                <li className="dense-card p-3"><span className="font-semibold">Connected.</span> Setup does not connect the service. Grok shows “Key present” only when the server key exists.</li>
              </ul>
            </section>
          )}
          {view === "settings" && (
            <section className="page-shell mx-auto max-w-3xl space-y-4">
              <div className="page-hero">
                <h2 className="font-display text-3xl font-bold">Settings</h2>
                <p className="text-sm text-muted">Preferences stay in this browser. Server keys are not edited here.</p>
              </div>
              <div className="settings-card card-texture rounded-panel p-4 text-sm">
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">Appearance</p>
                    <p className="text-muted">Theme for the app UI. Saved in this browser only.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["dark", "light", "system"] as const).map((choice) => (
                      <button key={choice} type="button" className={`min-h-11 rounded-panel border px-3 ${theme === choice ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => setTheme(choice)}>
                        {choice}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">Provider failover</p>
                    <p className="text-muted">Off. A failed or unconfigured provider is not replaced with another one.</p>
                  </div>
                  <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">Off</span>
                </div>
              </div>
              <div className="settings-card rounded-panel p-4 text-sm hidden">
                <p className="font-semibold">Provider failover</p>
                <p className="mt-1 text-muted">
                  {failoverPolicy === "none"
                    ? "Off. A failed or unconfigured provider is not replaced with another one. Chat still sends only through Grok when that key is present."
                    : "On. If the selected provider cannot run, chat may switch to Grok when that key is present. The switch is recorded in the notice."}
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={failoverPolicy === "grok"}
                  className={`mt-3 flex min-h-11 w-full items-center justify-between rounded-panel border border-line px-3 ${failoverPolicy === "grok" ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}
                  onClick={() => setFailoverPolicy((current) => (current === "grok" ? "none" : "grok"))}
                >
                  Allow switch to Grok
                  <span className={`h-6 w-11 rounded-full ${failoverPolicy === "grok" ? "bg-accent-ink/30" : "bg-line"}`} />
                </button>
              </div>
              <p className="text-sm text-muted">Storage on this device: {formatBytes(storedBytes)}. {syncNote}</p>
              {serverHeld && (
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    const run = () =>
                      void publishServerCopy().then((result) => {
                        if (!result.ok) {
                          reportFailure(result.error || HONEST_FAILURE_MESSAGES.database_write_failed, "database_write_failed", "server-copy", run);
                          return;
                        }
                        clearFailure();
                      }).catch(() => {
                        reportFailure(HONEST_FAILURE_MESSAGES.database_write_failed, "database_write_failed", "server-copy", run);
                      });
                    run();
                  }}
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
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line/70 bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Primary">
        {NAV.filter((item) => item.id === "command" || item.id === "agents").map((item) => {
          const Icon = item.icon;
          const on = view === item.id;
          return (
            <button key={item.id} type="button" className={`flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] ${on ? "text-fg" : "text-muted"}`} onClick={() => { setView(item.id); setNavOpen(false); }}>
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          className="sidebar-plus relative -mt-3 flex size-14 flex-col items-center justify-center rounded-full bg-accent text-accent-ink"
          aria-label="New chat"
          onClick={() => { openChat(); setView("chat"); setNavOpen(false); }}
        >
          <Plus className="size-5" />
        </button>
        {NAV.filter((item) => item.id === "build" || item.id === "projects").map((item) => {
          const Icon = item.icon;
          const on = view === item.id;
          return (
            <button key={item.id} type="button" className={`flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] ${on ? "text-fg" : "text-muted"}`} onClick={() => { setView(item.id); setNavOpen(false); }}>
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
    </div>
  );
}

function Quick({ label, icon: Icon, tone, onClick }: { label: string; icon: typeof Folder; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-panel border border-line/80 bg-surface/80 px-3 text-sm shadow-[0_8px_24px_rgb(0_0_0/0.25)] backdrop-blur">
      <Icon className={`size-4 ${tone}`} />
      {label}
    </button>
  );
}

function Panel({ title, action, onAction, children }: { title: string; action: string; onAction: () => void; children: ReactNode }) {
  return (
    <section className="glow-card rounded-panel border border-line/80 p-4">
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
    <div className="overlay-backdrop fixed inset-0 z-40 grid place-items-end p-4 md:place-items-center">
      <div className="overlay-panel w-full max-w-md rounded-[1.25rem] p-4">{children}</div>
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
        <div className="dense-card card-texture p-4">
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
  speaking,
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
  modelTier,
  onModelTier,
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
  speaking: boolean;
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
  modelTier: ModelTier;
  onModelTier: (tier: ModelTier) => void;
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
            <div className="mt-3">
              <ModelTierPicker name="mind-tier-mobile" tier={modelTier} onChoose={onModelTier} />
            </div>
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
            <article key={msg.id} className={`max-w-3xl rounded-panel border border-line/70 px-3 py-2 text-sm shadow-[0_10px_28px_rgb(0_0_0/0.28)] ${msg.role === "user" ? "ml-auto bg-surface-2/90" : "bg-surface/90 backdrop-blur"}`}>
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
              <p className="mb-1 text-xs text-muted">{modelTier} · writing</p>
              <p className="whitespace-pre-wrap">{liveText}</p>
            </article>
          )}
          {busy && !liveText && (
            <div className="max-w-3xl space-y-2 rounded-panel border border-line/70 bg-surface/80 p-3" aria-live="polite">
              <p className="text-xs text-muted">Waiting for Grok.</p>
              <div className="skeleton h-3" style={{ width: "75%" }} />
              <div className="skeleton h-3" style={{ width: "50%" }} />
              <div className="skeleton h-3" style={{ width: "66%" }} />
            </div>
          )}
          {busy && (
            <button type="button" className="min-h-11 text-sm text-danger" onClick={onStop}>Stop this reply</button>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          {error && active?.messages.at(-1)?.role === "user" && (
            <button type="button" className="min-h-11 text-sm text-accent" disabled={busy || halted} onClick={onRetry}>Retry</button>
          )}
          {active && <p className="text-xs text-muted">Chat memory is {active.memory === "on" ? "on" : "off"} for this session. The agent session is on this device. Hosted realtime is not connected. The schedule worker is separate.</p>}
        </div>
        <form
          className="floating-composer command-card m-3 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
        >
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message (${modelTier})...`} className="input-glow min-h-11 w-full rounded-xl bg-transparent px-1 text-sm outline-none" />
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
            <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onAttach}>
              <Paperclip className="size-4" /> Attach
            </button>
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={() => { setContext((open) => !open); setTools(false); }}>Add Context</button>
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={() => { setTools((open) => !open); setContext(false); }}>Tools</button>
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onDelete} disabled={!active}>Delete</button>
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onMemory} disabled={!active}>{memoryChoice === "on" ? "Memory on" : "Memory off"}</button>
            <button type="submit" disabled={busy || halted || !active} className="ml-auto min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">Send</button>
          </div>
        </form>
      </section>
      <aside className="hidden w-72 shrink-0 flex-col gap-3 border-l border-line/70 p-3 xl:flex">
        <section className="glass-panel rounded-panel p-3">
          <ProviderPicker name="mind-provider-side" choices={choices} choice={providerChoice} onChoose={onProvider} />
        </section>
        <section className="glass-panel rounded-panel p-3">
          <ModelTierPicker name="mind-tier-side" tier={modelTier} onChoose={onModelTier} />
        </section>
        <section className="glass-panel rounded-panel p-3">
          <button type="button" onClick={() => onComposerMode("ask")} className={`mb-2 min-h-11 w-full rounded-panel px-3 text-left text-sm ${mode === "ask" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80"}`}>Ask</button>
          <button type="button" onClick={() => onComposerMode("automatic")} className={`min-h-11 w-full rounded-panel px-3 text-left text-sm ${mode === "automatic" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80"}`}>Automatic</button>
        </section>
        <section className="glass-panel rounded-panel p-3">
          <button type="button" role="switch" aria-checked={memoryChoice === "on"} onClick={onComposerMemory} className="flex min-h-11 w-full items-center justify-between text-sm">
            Memory: {memoryChoice === "on" ? "ON" : "OFF"}
            <span className={`h-6 w-11 rounded-full ${memoryChoice === "on" ? "bg-accent" : "bg-line"}`} />
          </button>
          <p className="mt-2 text-xs text-muted">Off means this chat cannot read or save notes.</p>
        </section>
        <section className="glass-panel rounded-panel p-3 text-sm">
          <p className="font-semibold">{active?.title ?? "New session"}</p>
          <p className="text-xs text-muted">On this device · Memory {memoryChoice}</p>
        </section>
        <div className={`voice-zone-rail ${speaking ? "is-live" : ""}`} aria-label="Voice controls">
          <button type="button" className="focus-ring grid size-11 place-items-center rounded-full border border-line/80" onClick={onListen} aria-label="Dictate">
            <Mic className="size-4" />
          </button>
          <span className="waveform" aria-hidden="true"><span /><span /><span /><span /><span /></span>
          <button type="button" className="focus-ring grid size-11 place-items-center rounded-full border border-line/80" disabled={!lastReply || speaking} onClick={() => lastReply && onSpeak(lastReply.content)} aria-label="Speak">
            <Volume2 className="size-4" />
          </button>
        </div>
      </aside>
    </div>
  );
}

function ModelTierPicker({
  name,
  tier,
  onChoose,
}: {
  name: string;
  tier: ModelTier;
  onChoose: (tier: ModelTier) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Mode</legend>
      <p className="text-xs text-muted">Chooses which Grok model runs. Auto routes from the prompt.</p>
      {MODEL_TIERS.map((item) => (
        <label key={item} className="flex items-start gap-2 text-sm">
          <input type="radio" name={name} checked={tier === item} onChange={() => onChoose(item)} className="mt-1" />
          <span className="font-medium">{item}</span>
        </label>
      ))}
    </fieldset>
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
      <legend className="text-sm font-semibold">Provider</legend>
      {choices.map((item) => (
        <label
          key={item.id}
          className={`flex items-start gap-2 rounded-xl px-2 py-2 text-sm ${choice === item.id ? "model-option-active" : "hover:bg-white/5"} ${!item.enabled ? "opacity-60" : ""}`}
        >
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
