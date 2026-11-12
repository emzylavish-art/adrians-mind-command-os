import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import "./command-drawer-nav.css";
import "./command-search.css";
import "./command-voice-mode.css";
import "./gpt-shell.css";
import { getBearerToken } from "@/lib/auth/client";
import { loadMcpWithHttpFallback } from "@/lib/mind/mcp-list-http";
import { getRecentChats } from "@/lib/mind/recent-chats";
import { SignedOut, UserButton } from "@/lib/auth/gates";
import { SupabaseAccountControls } from "@/components/mind/supabase-account";
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
  MicOff,
  Paperclip,
  Camera,
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
  Network,
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
import { consumeMindTurn, shouldStoreReply, STOPPED_REPLY } from "@/lib/mind/live-turn";
import { analyzeImageFile, createVoiceClientSecret, mcpCommand, mcpList, mcpRemove, mcpRegistryList, mcpRegistryToggle, mcpSave, mindStatus, notionCommand, notionDisconnect, notionStatus, recordAgentExecution, searchWeb, setExecutionHalt, speakText } from "@/lib/mind/server";
import { SafeKeysPanel } from "@/components/mind/safe-keys-panel";
import { copyOwnerKeyFn } from "@/lib/mind/owner-keys-fns";
import { AiProviderConnections } from "@/components/mind/ai-provider-connections";
import type { PublicAiProvider } from "@/lib/mind/ai-provider-config.server";
import { VoiceWaveform } from "@/components/mind/voice-waveform";
import { VoiceLevelMeter } from "@/components/mind/voice-level-meter";
import { VoiceLiveTranscript } from "@/components/mind/voice-live-transcript";
import { VoicePicker } from "@/components/mind/voice-picker";
import { LiveVoiceBar } from "@/components/mind/live-voice-bar";
import { DictationPill } from "@/components/mind/dictation-pill";
import { VoiceModeOverlay, type VoiceOverlayPhase } from "@/components/mind/voice-mode-overlay";
import { SpeakStage } from "@/components/mind/speak-stage";
import { SpeakPanel } from "@/components/mind/surfaces/speak-panel";
import { ChatEmptyHero } from "@/components/mind/chat-empty-hero";
import {
  ComposerBar,
  type ComposerModelId,
  DictationPill as PreviewDictationPill,
  LiveSpeakControl,
  LiveVoiceBar as PresentationalLiveVoiceBar,
  VoiceModeStage,
} from "@/components/mind/voice-ui";

const DashboardApp = lazy(() => import("@/components/mind/dashboard-3d/dashboard-app").then((mod) => ({ default: mod.DashboardApp })));
import { isLiveVoiceOccupied, LIVE_VOICE_BUSY_MESSAGE } from "@/lib/mind/voice-live/occupancy";
import { probeOllamaConductor, runOllamaConductor } from "@/lib/mind/voice/ollama-conductor";
import { DIRECT_FALLBACK_NOTICE, formatVoiceClientError, resolveVoiceMode } from "@/lib/mind/voice/errors";
import { commitVoiceMode, toggleVoiceMode, type VoiceRoutingMode } from "@/lib/mind/voice/mode";
import {
  getServerVoiceMode,
  getVoiceMode,
  hydrateVoiceModeStore,
  setVoiceModeStore,
  subscribeVoiceMode,
} from "@/lib/mind/voice/mode-store";
import { captureSpeakUtterance } from "@/lib/mind/voice/capture-utterance";
import { type SpeakRetryParams } from "@/lib/mind/voice/speak-action";
import { runMountedSpeak } from "@/lib/mind/voice/speak-click";
import { interruptMessageSpeak } from "@/lib/mind/voice/speak-control";
import { withSessionTimeout } from "@/lib/mind/voice/session-timeout";
import { clampSpeakText, sanitizeVoiceTranscript } from "@/lib/mind/voice/limits";
import { createListenGuard, resolveListenAction } from "@/lib/mind/voice/listen-guard";
import { formatMicCaptureError, VOICE_CONNECTION_DROPPED } from "@/lib/mind/voice/errors";
import {
  matchesVoiceToggleShortcut,
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
  resolveXaiVoiceId,
  type XaiBuiltinVoice,
  readStoredVoiceChoice,
  writeStoredVoiceChoice,
} from "@/lib/mind/voice/voices";
import { RealtimeVoiceSession } from "@/lib/mind/voice/realtime-session";
import { voiceSessionInstructions } from "@/lib/mind/voice-live/session-instructions";
import { readStoredCharacterId } from "@/lib/mind/characters";
import { noteSpokenText, readAvatarSession, setAvatarPresence } from "@/lib/mind/avatar/session";
import { applyWorkbenchCommand } from "@/lib/mind/workbench-command";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import { appendDictationText, blobToBase64, createDictationRecorder, type DictationRecorder } from "@/lib/mind/voice/dictation";
import {
  createDictationMachine,
  DICTATION_SILENCE_PEAK,
  reduceDictation,
  type DictationAction,
  type DictationMachineState,
} from "@/lib/mind/voice/dictation-machine";
import { dictationTranscriptForTestAudio } from "@/lib/mind/voice/test-audio";
import {
  createVoiceConnectState,
  enterStage,
  failStage,
  normalizeVoiceConnectError,
  stageTimeoutMessage,
  VOICE_STAGE_TIMEOUT_MS,
  type VoiceConnectStage,
} from "@/lib/mind/voice/connection-stages";
import {
  createBargeInState,
  reduceBargeIn,
  shouldCutPlayback,
  SPEAKING_MIN_VISIBLE_MS,
  type BargeInAction,
} from "@/lib/mind/voice/barge-in";
import {
  allowCancel,
  beginFlight,
  completeSpeak,
  createCancelBudget,
  createFlightGate,
  createSpeakQueue,
  createTranscriptDedupe,
  endFlight,
  enqueueSpeak,
  nextMuteState,
  secretNeedsRemint,
  shouldAcceptTranscript,
  toggleMute,
} from "@/lib/mind/voice/spam-guard";
import { buildVoiceChatTurn } from "@/lib/mind/voice/voice-chat-turn";
import { routeVoiceModeTranscript } from "@/lib/mind/voice/transcript-routing";
import type { Chat, MemoryScope, Msg, Workspace } from "@/lib/mind/types";
import { ServiceBoard } from "@/components/mind/service-board";
import { EveWorkbench } from "@/components/mind/eve-workbench";
import { FleetPanel } from "@/components/mind/fleet-panels";
import { BuildWorkspace } from "@/components/mind/build-workspace";
import { BuildPanel } from "@/components/mind/surfaces/build-panel";
import { ResearchPanel } from "@/components/mind/surfaces/research-panel";
import { MessageBody } from "@/components/mind/message-body";
import { MemorySavedIndicator } from "@/components/mind/memory-saved-indicator";
import { MemoryChatToggle } from "@/components/mind/memory-chat-toggle";
import { AttachmentChips } from "@/components/mind/media/attachment-chips";
import { CameraCapture } from "@/components/mind/media/camera-capture";
import { CloudPicker, type CloudPickerAttach } from "@/components/mind/media/cloud-picker";
import { InlineImage } from "@/components/mind/media/inline-image";
import { fileToDownscaledDataUrl } from "@/components/mind/media/downscale";
import { historyTextForImages, parseImagineCommand, toImageAttachments, type ImageAttachment } from "@/lib/mind/media";
import { haltFleet, enqueueRun, runDueSchedules, togglePin } from "@/lib/mind/fleet";
import { interpretCommand, type CommandMode } from "@/lib/mind/intent";
import { paletteHits } from "@/lib/mind/palette";
import { paletteKeyAction } from "@/lib/mind/palette-keys";
import { runLocalPlan } from "@/lib/mind/local-tools";
import { greeting } from "@/lib/mind/greeting";
import { relevantMemories } from "@/lib/mind/memory";
import { databaseMode } from "@/lib/mind/persistence";
import { runAgentTurn, type AgentTool, type ToolEvent } from "@/lib/mind/orchestrator";
import {
  agentActivityFromTimeline,
  applyToolEvent,
  attachAuditIds,
  connectedServicesRail,
  elapsedMs,
  formatElapsed,
  recentTasksFromAudit,
  systemStatusRail,
  timelineCounts,
  type ToolTimelineRow,
} from "@/lib/mind/tools-timeline";
import { describeFile } from "@/lib/mind/files-read";
import { extractPdfText } from "@/lib/mind/pdf-text";
import { ModelTierChip } from "@/components/mind/model-tier-chip";
import { MODEL_TIERS, type ConcreteModelTier, type ModelTier } from "@/lib/mind/model-tiers";
import { chosenProvider, failover, providerChoicesWithKeys } from "@/lib/mind/providers";
import { emitFailure, mountFailure, surfaceForReport } from "@/lib/mind/failure-mount";
import { useMcpFailureMount, type McpReportedOutcome } from "./use-mcp-failure-mount";
import { routeFailureAction, type RouteFailureAction } from "@/lib/mind/route-failure";
import {
  LOGIC_ROUTES,
  chatTurnBody,
  isLogicRouteId,
  logicMenuState,
  readSelection,
  respondedRouteLabel,
  writeSelection,
  type LogicRouteId,
  type LogicRoutePublic,
} from "@/lib/mind/logic-routes";
import { runSkill, searchSkills, SKILLS } from "@/lib/mind/skills";
import LocalSkillsTools from "@/components/mind/local-skills-tools";
import { exportChat, prepareRegenerate, prepareRetry, renameChat, reviseUserTurn } from "@/lib/mind/transcript";
import { useMindWorkspace } from "@/lib/mind/use-mind-workspace";
import { COMPOSER_MODES, effortForModelTier, effortModelTier, loadComposerEffort, resolveSendPath, saveComposerEffort, type ComposerModeId } from "@/lib/mind/composer-modes";
import { planRouting, readRatings, readRoutingMode, readRoutingPanel, ROUTING_MODE_LABEL, saveRating, writeRoutingMode, writeRoutingPanel, type ResponseRating, type RoutingMode } from "@/lib/mind/routing-modes";
import { canSend } from "@/lib/mind/send-gate";
import { saveFailureMessage } from "@/lib/mind/save-error";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceActivation,
  type VoicePersonality,
  type VoiceSettings,
  type VoiceSpeed,
} from "@/lib/mind/voice/settings";
import {
  classifyHonestFailure,
  honestFailureAuditAction,
  HONEST_FAILURE_MESSAGES,
  imageGenerationFailure,
  imagineRetryParams,
  mcpToolFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "@/lib/mind/failure-states";
import {
  commandSendPlan,
  historyForDeliver,
  onceRetry,
  resolveChatMessages,
  shouldBlockForEmergencyStop,
  snapshotImages,
} from "@/lib/mind/retry-fidelity";
import { McpListStatusRows, loadMcpList, onceListRetry, type McpListServer, type McpListState } from "@/lib/mind/mcp-list-state";
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
  updateChatPersonality,
  updateChatCustomPersonality,
} from "@/lib/mind/workspace";
import { WORKSPACE_ROUTE_LINKS } from "@/lib/mind/workspace-nav";
import { CONVERSATIONAL_PERSONALITIES, type PersonalityId } from "@/lib/mind/personalities";

type View =
  | "command"
  | "intelligence"
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
  | "settings"
  | "dashboard";

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
    mark: "/brand/marks/oak-bridge.png",
  },
  {
    name: "BridgePoint",
    detail: "Separate product. This app does not open, edit, or store it.",
    mark: "/brand/marks/bridgepoint.png",
  },
];

type Staged = { name: string; text: string };

const NAV_ICON_SRC: Partial<Record<View, string>> = {
  files: "/brand/marks/library.png",
  projects: "/brand/marks/projects.png",
  connected: "/brand/marks/plugins.png",
  scheduled: "/brand/marks/scheduled.png",
  build: "/brand/marks/build.png",
  research: "/brand/marks/research.png",
  agents: "/brand/marks/bots.png",
  runs: "/brand/marks/runs.png",
  tools: "/brand/marks/tools.png",
  skills: "/brand/marks/skills.png",
  memory: "/brand/marks/memory.png",
  activity: "/brand/marks/activity.png",
  help: "/brand/marks/help.png",
  integrations: "/brand/marks/integrations.png",
  settings: "/brand/marks/settings.png",
};


const NAV_GROUPS: { label: string; items: { id: View; label: string; icon: typeof Home }[] }[] = [
  {
    label: "Main",
    items: [
      { id: "files", label: "Library", icon: FileText },
      { id: "projects", label: "Projects", icon: Folder },
      { id: "connected", label: "Plugins", icon: Zap },
      { id: "scheduled", label: "Scheduled", icon: CalendarClock },
    ],
  },
];

const SETTINGS_PAGES: { group: string; items: { id: View; label: string; detail: string }[] }[] = [
  {
    group: "Work",
    items: [
      { id: "intelligence", label: "EVE", detail: "Operator workbench" },
      { id: "agents", label: "Bots", detail: "Agents and templates" },
      { id: "dashboard", label: "3D graph", detail: "Workspace map" },
      { id: "projects", label: "Projects", detail: "Records on this device" },
      { id: "research", label: "Research", detail: "Search when a provider is set" },
      { id: "files", label: "Library", detail: "Text copies in this browser" },
      { id: "chat", label: "Threads", detail: "One conversation at a time" },
      { id: "runs", label: "Runs", detail: "What an agent already did" },
    ],
  },
  {
    group: "System",
    items: [
      { id: "tools", label: "Tools", detail: "What this app can call" },
      { id: "skills", label: "Skills", detail: "Installed abilities" },
      { id: "scheduled", label: "Scheduled", detail: "Jobs that wait for a time" },
      { id: "memory", label: "Memory", detail: "Notes you chose to keep" },
      { id: "activity", label: "Activity", detail: "What this device recorded" },
      { id: "integrations", label: "Integrations", detail: "Provider setup" },
      { id: "help", label: "Help", detail: "How the controls behave" },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

const TITLES: Record<View, string> = {
  command: "Chat",
  intelligence: "EVE / Intelligence",
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
  dashboard: "Dashboard",
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

const CAPABILITY_MARK: Record<string, string> = {
  "chat.grok": "grok",
  "chat.openai": "openai",
  "chat.anthropic": "claude",
  "chat.gemini": "gemini",
  "chat.openrouter": "openrouter",
  "chat.local": "computer",
  policy: "safety",
  memory: "memory",
  supabase: "datasource",
  rea: "tools",
  pc: "computer",
  research: "research",
  agents: "bots",
  "agents.planner": "plan",
  "agents.worker": "bots",
  "agents.hosted": "vercel",
  "browser.inspect": "browser",
  gmail: "gmail",
  image: "media",
  video: "media",
  voice: "voice",
  "shell.palette": "search",
  "shell.pins": "recent",
  "chat.router": "connections",
  notion: "notion",
  "build.workspace": "build",
};

const CAPABILITY_PAGE: Partial<Record<string, View>> = {
  "chat.grok": "connected",
  "chat.openai": "settings",
  "chat.anthropic": "settings",
  "chat.gemini": "settings",
  "chat.openrouter": "settings",
  "chat.local": "connected",
  policy: "settings",
  memory: "memory",
  pc: "connected",
  research: "research",
  agents: "agents",
  "agents.planner": "agents",
  "agents.worker": "agents",
  "agents.hosted": "agents",
  "browser.inspect": "tools",
  gmail: "connected",
  image: "connected",
  video: "connected",
  voice: "settings",
  "shell.palette": "command",
  "chat.router": "settings",
  notion: "connected",
  "build.workspace": "build",
};

const CAPABILITY_CONNECT: Partial<Record<string, string>> = {
  "chat.openai": "OpenAI",
  "chat.anthropic": "Claude",
  "chat.gemini": "Gemini",
  "chat.openrouter": "OpenRouter",
  notion: "Notion",
};

function openCapability(id: string, setView: (view: View) => void, setSettingsPane: (pane: null | "general" | "connections" | "voice" | "pages" | "data" | "safety") => void) {
  const page = CAPABILITY_PAGE[id];
  if (!page) return;
  const connect = CAPABILITY_CONNECT[id];
  setView(page);
  setSettingsPane(page !== "settings" ? null : id === "voice" ? "voice" : connect ? "connections" : null);
  if (connect) {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("adrian-open-connect", { detail: { name: connect } }));
      document.getElementById(connect === "Notion" ? "owner-notion-search" : "owner-api-connect")?.scrollIntoView({ block: "center" });
    }, 60);
  }
}

const SKILL_MARK: Record<string, string> = {
  projects: "projects",
  chats: "chat",
  notes: "memory",
  notion: "notion",
  browser: "browser",
  voice: "voice",
  gmail: "gmail",
};

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
    forbidden_cross_site: "Blocked a cross-site request",
    notion_failed: "Notion search failed",
  };
  return map[action] ?? action.replaceAll("_", " ");
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

type SavedMcpServer = {
  id: string;
  label: string;
  host: string;
  state: "unchecked" | "connected" | "failed";
  tools: { name: string; description: string }[];
  error: string;
};

function isSavedMcpServer(server: unknown): server is SavedMcpServer {
  if (!server || typeof server !== "object") return false;
  const row = server as Partial<SavedMcpServer>;
  return (
    typeof row.id === "string" &&
    typeof row.label === "string" &&
    typeof row.host === "string" &&
    (row.state === "unchecked" || row.state === "connected" || row.state === "failed") &&
    Array.isArray(row.tools) &&
    typeof row.error === "string"
  );
}

/** Live transcript for Retry: keep a flushed user turn, but do not resurrect a reply the caller just removed. */
function selectRetryMessages(passed: Msg[], live: Msg[]): Msg[] {
  if (live.length === passed.length) {
    const passedLast = passed.at(-1);
    const liveLast = live.at(-1);
    if (passedLast?.role === "user" && liveLast?.role === "user" && passedLast.content !== liveLast.content) return passed;
    return live;
  }
  if (live.length === passed.length + 1 && live.at(-1)?.role === "user") return live;
  if (passed.length + 1 === live.length && passed.at(-1)?.role === "user" && live.at(-1)?.role === "assistant") return passed;
  if (passed.length < live.length && passed.at(-1)?.role === "user") return passed;
  return live.length >= passed.length ? live : passed;
}

type BrowserSpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: { results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function browserSpeechCtor(): (new () => BrowserSpeechRec) | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRec;
    webkitSpeechRecognition?: new () => BrowserSpeechRec;
  };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function isEnabledSkillMap(value: unknown): value is Record<string, boolean> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "boolean");
}

export function CommandApp() {
  const { ws, setWs, ready, syncNote, serverHeld, saveError, retrySave } = useMindWorkspace();
  const [view, setView] = useState<View>("command");
  const [homeAction, setHomeAction] = useState<"ask" | "image" | "write" | "search">("ask");
  const [settingsPane, setSettingsPane] = useState<null | "general" | "connections" | "voice" | "pages" | "data" | "safety" | "keys">(null);
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const navDrawerRef = useRef<HTMLElement>(null);
  const navCloseRef = useRef<HTMLButtonElement>(null);
  const navTriggerRef = useRef<HTMLButtonElement>(null);
  const navWasOpenRef = useRef(false);
  const [voiceSignInNotice, setVoiceSignInNotice] = useState(false);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = pageScrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [view]);
  useEffect(() => {
    if (!navOpen) {
      if (navWasOpenRef.current) {
        const trigger = navTriggerRef.current;
        if (trigger?.isConnected && trigger.getClientRects().length > 0) {
          trigger.focus();
        } else {
          // The mobile trigger is hidden at desktop breakpoints. Keep focus
          // inside the now non-modal sidebar rather than on a hidden control.
          const visibleItem = Array.from(navDrawerRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? []).find((item) => item.getClientRects().length > 0);
          visibleItem?.focus();
        }
      }
      navWasOpenRef.current = false;
      return;
    }
    navWasOpenRef.current = true;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navCloseRef.current?.focus();
    const onDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setNavOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = navDrawerRef.current;
      if (!drawer) return;
      const items = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((item) => item.getAttribute("aria-hidden") !== "true" && item.offsetParent !== null);
      if (!items.length) {
        event.preventDefault();
        navCloseRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setNavOpen(false);
    };
    desktop.addEventListener("change", closeAtDesktop);
    document.addEventListener("keydown", onDrawerKeyDown, true);
    return () => {
      document.body.style.overflow = previous;
      desktop.removeEventListener("change", closeAtDesktop);
      document.removeEventListener("keydown", onDrawerKeyDown, true);
    };
  }, [navOpen]);
  const openNav = (event: ReactMouseEvent<HTMLButtonElement>) => {
    navTriggerRef.current = event.currentTarget;
    setNavOpen(true);
  };
  const closeNavFromBackdrop = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) setNavOpen(false);
  };
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [commandMode, setCommandMode] = useState<CommandMode>("ask");
  const [defaultPersonalityId, setDefaultPersonalityId] = useState<PersonalityId>("assistant");
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
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [voiceLiveTranscript, setVoiceLiveTranscript] = useState("");
  const [voiceChoice, setVoiceChoice] = useState<XaiBuiltinVoice>(DEFAULT_XAI_VOICE);
  const voiceChoiceRef = useRef<XaiBuiltinVoice>(DEFAULT_XAI_VOICE);
  const listenMintAbortRef = useRef<AbortController | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const speakGenRef = useRef(0);
  const listenGuardRef = useRef(createListenGuard());
  const voiceReconnectRef = useRef(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [dictation, setDictation] = useState<DictationMachineState>(() => createDictationMachine(""));
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  const dictationRecRef = useRef<BrowserSpeechRec | null>(null);
  const serverDictationRef = useRef<DictationRecorder | null>(null);
  const dictationBufferRef = useRef("");
  const userStoppedDictationRef = useRef(false);
  const [dictationElapsed, setDictationElapsed] = useState(0);
  const [dictationLevel, setDictationLevel] = useState(0);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const [speakStageOpen, setSpeakStageOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = voiceOverlayOpen;
  const [overlayPhase, setOverlayPhase] = useState<VoiceOverlayPhase>("idle");
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [overlayNotice, setOverlayNotice] = useState<string | null>(null);
  const connectStateRef = useRef(createVoiceConnectState());
  const bargeRef = useRef(createBargeInState());
  const holdInterruptedRef = useRef(false);
  const lastLevelAtRef = useRef(0);
  const lastSessionStatusRef = useRef<string>("idle");
  const transcriptDedupeRef = useRef(createTranscriptDedupe());
  const speakQueueRef = useRef(createSpeakQueue());
  const flightGateRef = useRef(createFlightGate());
  const voiceCancelBudgetRef = useRef(createCancelBudget());
  const voiceMutedRef = useRef(false);
  voiceMutedRef.current = voiceMuted;
  const stageTimerRef = useRef(0);
  const stageGenRef = useRef(0);
  const voiceActiveRef = useRef(false);
  const closeVoiceOverlayRef = useRef<() => void>(() => undefined);
  const cancelDictationRef = useRef<(announce?: boolean) => void>(() => undefined);
  const turnGen = useRef(0);
  const turnInFlight = useRef(false);
  const imagineInFlight = useRef(false);
  const mcpInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ message: string; auditId: string; retry: (() => void) | null; kind: HonestFailureKind | null; action?: RouteFailureAction } | null>(null);
  const reportFailureRef = useRef<(message: string, action: string, target: string, retry: (() => void) | null) => void>(() => undefined);
  const [toolTimeline, setToolTimeline] = useState<ToolTimelineRow[]>([]);
  const [timelineTickMs, setTimelineTickMs] = useState(0);
  const [statusSignedIn, setStatusSignedIn] = useState<boolean | null>(null);
  const [databaseConfigured, setDatabaseConfigured] = useState(false);
  const [focusAuditId, setFocusAuditId] = useState<string | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const [grok, setGrok] = useState("Checking");
  const [databasePill, setDatabasePill] = useState("Checking");
  const [databaseDetail, setDatabaseDetail] = useState("The status check has not finished.");
  const [grokConfigured, setGrokConfigured] = useState<boolean | null>(null);
  const [liveProviders, setLiveProviders] = useState<Partial<Record<"openai" | "anthropic" | "gemini" | "openrouter", boolean>>>({});
  const [providerChoice, setProviderChoice] = useState("grok");
  const [customAiProviders, setCustomAiProviders] = useState<PublicAiProvider[]>([]);
  const customAiChoices = customAiProviders.flatMap((item) => item.models.map((model) => ({ id: `custom:${item.id}:${encodeURIComponent(model)}`, label: `${item.label}: ${model}`, enabled: true, reason: `Custom API at ${item.host}. Requires usable API credit.` })));
  const [modelTier, setModelTier] = useState<ModelTier>("Auto");
  const [logicRoute, setLogicRoute] = useState<LogicRouteId | null>(null);
  const [logicRoutes, setLogicRoutes] = useState<LogicRoutePublic[]>([]);
  const [composerEffort, setComposerEffort] = useState<ComposerModeId>("auto");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("A");
  const [routingPanel, setRoutingPanel] = useState<LogicRouteId[]>([]);
  const [ratings, setRatings] = useState<ResponseRating[]>([]);
  const [lastResolvedTier, setLastResolvedTier] = useState<ConcreteModelTier | null>(null);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [failoverPolicy, setFailoverPolicy] = useState<"none" | "grok">("none");
  const [researchCitations, setResearchCitations] = useState<{ title: string; url: string }[]>([]);
  const [agentGoal, setAgentGoal] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [agentLog, setAgentLog] = useState<{ step: number; tool: string; ok: boolean; detail: string }[]>([]);
  const [agentImages, setAgentImages] = useState<ImageAttachment[]>([]);
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
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (ws.halted) {
      setAvatarPresence("offline");
      return;
    }
    if (speaking) return;
    const live = readAvatarSession().presence;
    if (live === "processing" || live === "speaking" || live === "interrupted" || live === "error") return;
    const waiting = ws.runs.some((run) => run.state === "waiting_approval");
    const executing = ws.runs.some((run) => run.state === "running");
    if (voiceListening) {
      setAvatarPresence("listening");
      return;
    }
    if (waiting) {
      setAvatarPresence("waiting_approval");
      return;
    }
    if (executing) {
      setAvatarPresence("executing");
      return;
    }
    if (live === "listening" || live === "offline" || live === "waiting_approval" || live === "executing") {
      setAvatarPresence("idle");
    }
  }, [ws.halted, ws.runs, voiceListening, speaking]);

  useEffect(() => {
    // Single store: hydrate from localStorage once; every badge reads the same snapshot.
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    hydrateVoiceModeStore(storage);
    const choice = readStoredVoiceChoice(storage);
    voiceChoiceRef.current = choice;
    setVoiceChoice(choice);
  }, []);

  useEffect(() => {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    setComposerEffort(loadComposerEffort(storage));
  }, []);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  useEffect(() => {
    if (dictation.phase !== "recording") {
      setDictationElapsed(0);
      return;
    }
    const started = Date.now();
    setDictationElapsed(0);
    const id = window.setInterval(() => {
      setDictationElapsed(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [dictation.phase]);

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
    // commitVoiceMode persists; setVoiceModeStore keeps every badge on the same value.
    const committed = setVoiceModeStore(commitVoiceMode(next, storage), storage);
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

  function chooseComposerEffort(mode: ComposerModeId) {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    saveComposerEffort(storage, mode);
    setComposerEffort(mode);
    const resolved = resolveSendPath(mode);
    if (resolved.notice) setNotice(resolved.notice);
    const tier = effortModelTier(mode);
    if (tier) {
      setLogicRoute(null);
      setModelTier(tier);
    }
    applyVoiceMode(mode === "orchestrator" ? "orchestrator" : "direct");
    if (mode === "build") setView("build");
  }

  function chooseModelTier(tier: ModelTier) {
    setLogicRoute(null);
    if (isLogicRouteId(providerChoice)) setProviderChoice("grok");
    setModelTier(tier);
    const effort = effortForModelTier(tier);
    if (effort) {
      saveComposerEffort(typeof localStorage === "undefined" ? null : localStorage, effort);
      setComposerEffort(effort);
    }
  }

  function chooseRoutingMode(mode: RoutingMode) {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    writeRoutingMode(storage, mode);
    setRoutingMode(mode);
  }

  function toggleRoutingSeat(id: LogicRouteId) {
    setRoutingPanel((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      writeRoutingPanel(typeof localStorage === "undefined" ? null : localStorage, next);
      return next;
    });
  }

  function rateReply(messageId: string, score: 1 | 2 | 3 | 4 | 5, model: string | null) {
    const next = saveRating(typeof localStorage === "undefined" ? null : localStorage, {
      messageId,
      score,
      model,
      mode: routingMode,
      at: new Date().toISOString(),
    });
    setRatings(next);
  }

  function interruptSpeakPlayback() {
    interruptMessageSpeak({
      sharedAudio: sharedAudioOutput,
      abortSpeak: speakAbortRef.current,
      speechSynthesis: typeof window !== "undefined" ? window.speechSynthesis : null,
    });
    speakAbortRef.current = null;
    setSpeaking(false);
    setAvatarPresence("interrupted");
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
      clearStageTimeout();
      voiceActiveRef.current = false;
      speakQueueRef.current.active = null;
      speakQueueRef.current.pending = null;
      cancelDictationRef.current(false);
      overlayOpenRef.current = false;
      setVoiceOverlayOpen(false);
      setOverlayPhase("idle");
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
  const [mcpServers, setMcpServers] = useState<SavedMcpServer[]>([]);
  const [mcpRegistry, setMcpRegistry] = useState<{ id: string; label: string; kind: string; enabled: boolean }[]>([]);
  const [mcpRegistryListState, setMcpRegistryListState] = useState<McpListState>({ status: "loading" });
  const [mcpSavedListState, setMcpSavedListState] = useState<McpListState>({ status: "loading" });
  const mcpRegistryRetryRef = useRef<(() => void) | null>(null);
  const mcpSavedRetryRef = useRef<(() => void) | null>(null);
  const mcpRegistryGeneration = useRef(0);
  const mcpSavedGeneration = useRef(0);
  const mcpOwnerActive = useRef(false);
  const mcpReloadListsRef = useRef<(() => void) | null>(null);
  const mcpMutationInFlight = useRef(false);
  const mcpMutationGeneration = useRef(0);
  const [mcpMutationBusy, setMcpMutationBusy] = useState(false);
  const [toolResultStatus, setToolResultStatus] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [mcpLabel, setMcpLabel] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
  const [skillStorageError, setSkillStorageError] = useState("");
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

  const timelineRunning = useMemo(() => timelineCounts(toolTimeline).running, [toolTimeline]);
  useEffect(() => {
    if (!timelineRunning) return;
    setTimelineTickMs(Date.now());
    const id = window.setInterval(() => setTimelineTickMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timelineRunning]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    mcpOwnerActive.current = true;
    setMcpMutationBusy(false);
    mindStatus()
      .then((status) => {
        if (!active) return;
        setGrokConfigured(status.grok === "configured");
        if (status.providers && typeof status.providers === "object") setLiveProviders(status.providers);
        setGrok(status.grok === "configured" ? "Configured" : status.grok === "down" ? "Refused" : "Unavailable");
        setStatusSignedIn(status.signedIn === true);
        setDatabaseConfigured(status.databaseBackend === "postgres");
        const mode = databaseMode(status.databaseBackend === "postgres" || status.databaseBackend === "refused" ? status.databaseBackend : "memory");
        setDatabasePill(mode.pill);
        setDatabaseDetail(mode.detail);
        setSystem(status.database);
        setCheckedAt(status.checkedAt);
        if (Array.isArray(status.logicRoutes)) setLogicRoutes(status.logicRoutes);
        if (status.executionHalted && !clearedStop.current) {
          setWs((prev) => (prev.halted ? prev : pushAudit({ ...prev, halted: true }, "emergency_stop", "session", "server already stopped")));
        }
      })
      .catch(() => {
        if (!active) return;
        setGrok("Unavailable");
        setDatabasePill("Unknown");
        setDatabaseDetail("The status check did not finish.");
        setSystem("The status check did not finish.");
      });
    notionStatus()
      .then((status) => { if (active) setNotion(status); })
      .catch((caught) => {
        if (!active) return;
        const text = caught instanceof Error ? `${caught.name} ${caught.message}` : String(caught ?? "");
        if (/unauthorized|sign in/i.test(text)) {
          setNotion({ state: "disconnected", detail: "Sign in is required. Notion is not connected until you sign in." });
          return;
        }
        setNotion(null);
        const message = "Notion status could not be read. Its connection state is unknown.";
        reportFailureRef.current(message, "notion_status_failed", "notion:status", () => {
          void notionStatus().then((status) => { if (active) setNotion(status); }).catch(() => undefined);
        });
      });
    const loadMcpLists = () => {
      if (!active) return;
      const loadRegistry = () => {
        if (!active) return;
        const generation = ++mcpRegistryGeneration.current;
        setMcpRegistryListState({ status: "loading" });
        void loadMcpList(() => loadMcpWithHttpFallback(() => mcpRegistryList(), "registry", { bearerToken: getBearerToken() })).then((next) => {
          if (!active || generation !== mcpRegistryGeneration.current) return;
          setMcpRegistryListState(next);
          if (next.status === "ready") {
            setMcpRegistry(next.servers);
            mcpRegistryRetryRef.current = null;
            return;
          }
          setMcpRegistry([]);
          if (next.status !== "error") return;
          const retry = onceListRetry(loadRegistry);
          mcpRegistryRetryRef.current = retry;
          reportFailureRef.current(next.message, next.kind, "mcp:registry", retry);
        });
      };
      const loadSaved = () => {
        if (!active) return;
        const generation = ++mcpSavedGeneration.current;
        setMcpSavedListState({ status: "loading" });
        void loadMcpList(() => loadMcpWithHttpFallback(() => mcpList(), "saved", { bearerToken: getBearerToken() })).then((next) => {
          if (!active || generation !== mcpSavedGeneration.current) return;
          if (next.status === "ready" && next.servers.every(isSavedMcpServer)) {
            setMcpSavedListState(next);
            setMcpServers(next.servers as unknown as SavedMcpServer[]);
            mcpSavedRetryRef.current = null;
            return;
          }
          if (next.status === "ready") {
            const failed = {
              status: "error" as const,
              kind: "network_failure" as const,
              message: `${HONEST_FAILURE_MESSAGES.mcp_list_failed} (response was not JSON)`,
            };
            setMcpSavedListState(failed);
            setMcpServers([]);
            const retry = onceListRetry(loadSaved);
            mcpSavedRetryRef.current = retry;
            reportFailureRef.current(failed.message, failed.kind, "mcp:list", retry);
            return;
          }
          setMcpSavedListState(next);
          setMcpServers([]);
          if (next.status !== "error") return;
          const retry = onceListRetry(loadSaved);
          mcpSavedRetryRef.current = retry;
          reportFailureRef.current(next.message, next.kind, "mcp:list", retry);
        });
      };
      loadRegistry();
      loadSaved();
    };
    mcpReloadListsRef.current = loadMcpLists;
    loadMcpLists();
    try {
      const saved = localStorage.getItem("amcos.skills.v1");
      if (saved !== null) {
        const parsed: unknown = JSON.parse(saved);
        if (isEnabledSkillMap(parsed)) setEnabledSkills(parsed);
        else setSkillStorageError("Saved skill settings are invalid. The original data is preserved; skills use their default enabled state until this is repaired.");
      }
    } catch {
      setSkillStorageError("Skill settings could not be read from browser storage. Existing data was not changed.");
    }
    return () => {
      active = false;
      mcpOwnerActive.current = false;
      mcpRegistryGeneration.current += 1;
      mcpSavedGeneration.current += 1;
      mcpRegistryRetryRef.current = null;
      mcpSavedRetryRef.current = null;
      mcpReloadListsRef.current = null;
      mcpMutationGeneration.current += 1;
      mcpMutationInFlight.current = false;
    };
  }, [ready, setWs]);

  useEffect(() => {
    if (statusSignedIn !== true) return;
    let active = true;
    const bearer = getBearerToken();
    void fetch("/api/mind/providers", {
      credentials: "same-origin",
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { ok?: boolean; providers?: PublicAiProvider[] };
      if (active && body.ok && Array.isArray(body.providers)) setCustomAiProviders(body.providers);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [statusSignedIn]);

  useEffect(() => {
    try {
      const stored = readSelection(localStorage);
      setProviderChoice(stored.provider);
      setModelTier(stored.modelTier);
      setLogicRoute(stored.logicRoute);
      const fail = localStorage.getItem("amcos.failover.v1");
      if (fail === "grok" || fail === "none") setFailoverPolicy(fail);
      setRoutingMode(readRoutingMode(localStorage));
      setRoutingPanel(readRoutingPanel(localStorage));
      setRatings(readRatings(localStorage));
    } catch {
      /* a private browser can refuse storage */
    }
  }, []);

  useEffect(() => {
    writeSelection(localStorage, { provider: providerChoice, modelTier, logicRoute });
    try {
      localStorage.setItem("amcos.failover.v1", failoverPolicy);
    } catch {
      /* a private browser can refuse storage */
    }
  }, [providerChoice, modelTier, logicRoute, failoverPolicy]);

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
      if (event.key === "Escape") {
        if (overlayOpenRef.current) {
          event.preventDefault();
          closeVoiceOverlayRef.current();
          return;
        }
        setPaletteOpen(false);
      }
      if (matchesVoiceToggleShortcut(event) && shouldToggleVoiceShortcut(event, document)) {
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

  function openPaletteHit(hit: (typeof hits)[number]) {
    if (hit.view === "chat" && hit.ref) setActiveId(hit.ref);
    setView(hit.view);
    setQuery("");
    setPaletteIndex(0);
    setPaletteOpen(false);
    setNavOpen(false);
  }

  function onPaletteKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    const action = paletteKeyAction({
      key: event.key,
      open: paletteOpen,
      count: hits.length,
      index: paletteIndex,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    });
    if (action.type === "none") return;
    event.preventDefault();
    if (action.type === "close") {
      setPaletteOpen(false);
      return;
    }
    if (action.type === "move") {
      setPaletteIndex(action.index);
      return;
    }
    const hit = hits[action.index];
    if (hit) openPaletteHit(hit);
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

  function observeToolEvent(event: ToolEvent) {
    const atMs = typeof event.atMs === "number" ? event.atMs : Date.now();
    setToolTimeline((current) => applyToolEvent(current, { ...event, atMs }));
    if (event.status === "running" || event.status === "queued" || event.status === "awaiting_confirmation") return;
    const entryId = crypto.randomUUID();
    setToolTimeline((current) => attachAuditIds(current, { [event.toolId]: entryId }));
    setWs((prev) => ({
      ...prev,
      audit: [{ id: entryId, at: new Date(atMs).toISOString(), action: event.toolId, target: event.toolId, result: event.text.slice(0, 500) }, ...prev.audit].slice(0, 200),
    }));
  }

  function settleIntent(chat: Chat, text: string, source: Workspace, action: "chat" | "voice" = "chat"): boolean {
    const intent = interpretCommand(text, source.agents, commandMode);
    if (intent.kind === "chat") return false;
    if (intent.kind === "local" || intent.kind === "skill") {
      const toolId = intent.kind === "skill" ? "search_skills" : intent.tool;
      setToolTimeline([]);
      clearFailure();
      const turn = runAgentTurn({
        userId: "local-owner",
        sessionId: chat.id,
        text,
        modality: "chat",
        tools: agentTools(source),
        toolId,
        nowMs: Date.now(),
        onEvent: observeToolEvent,
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
            setToolTimeline([]);
            const again = runAgentTurn({
              userId: "local-owner",
              sessionId: chat.id,
              text,
              modality: "chat",
              tools: agentTools(source),
              toolId,
              confirm: grantNow,
              nowMs: Date.now(),
              onEvent: observeToolEvent,
            });
            recordToolTurn(chat, text, again.text, toolId === "run_due_schedules" && again.status === "completed" ? (prev) => runDueSchedules(prev, new Date().toISOString()) : undefined, { tool: toolId, ok: again.status === "completed", action });
            if (again.status === "failed" || again.status === "timed_out" || again.status === "cancelled") {
              reportFailure(again.text, "tool_failed", toolId, () => {
                settleIntent(chat, text, source, action);
              });
            }
            setNotice("The confirmed action finished on this device. Hosted realtime is not connected.");
          },
        });
        return true;
      }
      const notes = chat.memory === "on" ? relevantMemories(source.memories, text) : [];
      const reply = notes.length ? `${turn.text}\n\nSaved note: ${notes.map((item) => item.text).join(" ")}` : turn.text;
      recordToolTurn(chat, text, reply, undefined, { tool: toolId, ok: turn.status === "completed", action });
      if (turn.status === "failed" || turn.status === "timed_out" || turn.status === "cancelled") {
        reportFailure(turn.text, "tool_failed", toolId, () => {
          settleIntent(chat, text, source, action);
        });
      }
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
    if (intent.kind === "web_research") {
      void runWebResearch(chat, intent.query, action);
      return true;
    }
    recordToolTurn(chat, text, intent.reply);
    return true;
  }

  async function runWebResearch(chat: Chat, query: string, action: "chat" | "voice" = "chat") {
    setBusy(true);
    setError(null);
    try {
      const result = await searchWeb({ data: { query } });
      setBusy(false);
      setResearchCitations(result.citations);
      if (!result.ok) {
        const message = result.error;
        const retry = () => {
          void runWebResearch(chat, query, action);
        };
        emitFailure("research", mountFailure({ message, action: "research_failed", target: "search", outcome: result }, retry));
        recordToolTurn(chat, query, result.error, undefined, { tool: "web_search", ok: false, action });
        setResearchNote(result.error);
        return;
      }
      const lines = [
        result.summary || `Research returned ${result.citations.length} source${result.citations.length === 1 ? "" : "s"}:`,
        ...result.citations.map((item) => `- ${item.title} — ${item.url}`),
      ];
      recordToolTurn(chat, query, lines.join("\n"), undefined, { tool: "web_search", ok: true, action });
      setResearchNote(result.summary || "");
      setNotice(`Research kept ${result.citations.length} http(s) citation${result.citations.length === 1 ? "" : "s"}.`);
    } catch {
      setBusy(false);
      const message = "The search provider could not be reached. No citations were created.";
      const retry = () => {
        void runWebResearch(chat, query, action);
      };
      emitFailure("research", mountFailure({ message, action: "research_failed", target: "search" }, retry));
      recordToolTurn(chat, query, message, undefined, { tool: "web_search", ok: false, action });
      setResearchNote(message);
    }
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
      if (!result.ok) {
        const message = result.error || "Notion did not complete the requested operation.";
        const retry = () => { void askNotion(chat, text, confirmed, pageId); };
        reportFailure(message, "notion_operation_failed", "notion", retry, result.needsConfirmation ? "none" : "retry");
        recordToolTurn(chat, text, message, undefined, { tool: "notion", ok: false, action: "chat" });
        return;
      }
      const lines = [result.error, ...result.pages.map((page) => `${page.title} — ${page.url}`), result.content].filter(Boolean);
      recordToolTurn(chat, text, lines.join("\n") || "Notion returned nothing.");
    } catch {
      setBusy(false);
      const message = "Notion could not be reached. Nothing was changed.";
      const retry = () => {
        void askNotion(chat, text, confirmed, pageId);
      };
      if (emitFailure("notion", mountFailure({ message, action: "notion_unreachable", target: "notion" }, retry))) return;
      setError(message);
    }
  }

  async function askMcp(chat: Chat, text: string, confirmed = false) {
    if (mcpInFlight.current) return;
    mcpInFlight.current = true;
    setBusy(true);
    setError(null);
    clearFailure();
    setToolResultStatus("running");
    try {
      const result = await mcpCommand({ data: { text, confirmed } });
      setBusy(false);
      if (result.servers.every(isSavedMcpServer)) {
        setMcpServers(result.servers);
        setMcpSavedListState({
          status: "ready",
          servers: result.servers.map((server) => ({ id: server.id, label: server.label, kind: "saved", enabled: server.state !== "failed" })),
        });
      }
      if (result.needsConfirmation) {
        setToolResultStatus("idle");
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
      const reply = [result.error, result.text].filter(Boolean).join("\n") || "MCP returned nothing.";
      const status = result.ok ? "ok" : "error";
      setToolResultStatus(status);
      const failure = mcpToolFailure({
        ok: result.ok,
        status,
        text: result.text,
        error: result.error,
        needsConfirmation: result.needsConfirmation,
      });
      if (failure) {
        reportFailure(failure.message, failure.kind, failure.target, () => {
          void askMcp(chat, text, confirmed);
        });
      }
      recordToolTurn(chat, text, `[${status}] ${reply}`, undefined, { tool: "mcp", ok: result.ok, action: "chat" });
    } catch {
      setBusy(false);
      setToolResultStatus("error");
      const message = HONEST_FAILURE_MESSAGES.mcp_unreachable;
      reportFailure(message, "mcp_tool_failed", "mcp", () => {
        void askMcp(chat, text, confirmed);
      });
    } finally {
      mcpInFlight.current = false;
    }
  }

  async function deliver(
    chat: Chat,
    text: string,
    source: Workspace,
    resume = false,
    images: ImageAttachment[] = [],
    options?: { logicRoute?: LogicRouteId | null; skipUserMessage?: boolean; isolateOutputs?: boolean },
  ): Promise<string | null> {
    if (turnInFlight.current) return null;
    const snapped = snapshotImages(images);
    if (shouldBlockForEmergencyStop(wsRef.current.halted, source.halted)) {
      reportEmergencyStop(chat.id, () => {
        void deliver(chat, text, wsRef.current, resume, snapped);
      });
      return null;
    }
    const activeLogic = options && "logicRoute" in options
      ? options.logicRoute ?? null
      : logicRoute ?? (isLogicRouteId(providerChoice) ? providerChoice : null);
    if (activeLogic) {
      const view = logicRoutes.find((item) => item.id === activeLogic);
      if (!view?.ready) {
        const message = view?.reason ?? `${activeLogic} is not ready. Nothing was sent.`;
        const action = routeFailureAction({ state: view?.state ?? "needs-config", error: message });
        reportFailure(message, "model_unavailable", "provider", action === "retry" ? () => {
          void deliver(chat, text, wsRef.current, resume, snapped);
        } : null, action);
        return null;
      }
    }
    const isCustomProvider = providerChoice.startsWith("custom:") && !activeLogic;
    const otherReady = !activeLogic && !isCustomProvider && providerChoice !== "grok" && liveProviders[providerChoice as "openai" | "anthropic" | "gemini" | "openrouter"] === true;
    let routed = chosenProvider(activeLogic || isCustomProvider ? "grok" : providerChoice, isCustomProvider ? true : grokConfigured);
    if (!otherReady && !activeLogic && !isCustomProvider && !routed.ok) {
      const switched = failover(providerChoice, grokConfigured === true, failoverPolicy);
      if (switched.provider === "grok") {
        routed = chosenProvider("grok", grokConfigured);
        if (routed.ok) setNotice(switched.note);
      }
    }
    if (!otherReady && !activeLogic && !isCustomProvider && !routed.ok) {
      reportFailure(routed.error, "model_unavailable", "provider", () => {
        void deliver(chat, text, wsRef.current, resume, snapped);
      });
      return null;
    }
    let live = resolveChatMessages(wsRef.current.chats, chat.id, chat) as Msg[];
    if (options?.isolateOutputs) {
      let lastUser = -1;
      live.forEach((item, index) => {
        if (item.role === "user") lastUser = index;
      });
      if (lastUser >= 0) live = live.slice(0, lastUser + 1);
    }
    const messages = selectRetryMessages(chat.messages, live);
    if (resume && messages.at(-1)?.role === "assistant") return null;
    const history = historyForDeliver(messages, resume);
    const retryThisTurn = () => {
      if (turnInFlight.current) return;
      const liveNow = resolveChatMessages(wsRef.current.chats, chat.id, chat) as Msg[];
      const chosen = selectRetryMessages(chat.messages, liveNow);
      if (chosen.at(-1)?.role === "assistant") return;
      void deliver(chat, text, wsRef.current, true, snapped);
    };
    const title = resume || messages.length > 0 ? chat.title : text.replace(/\s+/g, " ").slice(0, 48);
    if (!resume && !options?.skipUserMessage) {
      const displayText = historyTextForImages(text, snapped);
      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: displayText,
        at: new Date().toISOString(),
        images: snapped.length ? snapped.map((image) => ({ dataUrl: image.dataUrl, name: image.name })) : undefined,
      };
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
    setToolTimeline([]);
    turnAbort.current?.abort();
    const generation = ++turnGen.current;
    const controller = new AbortController();
    turnAbort.current = controller;
    const timeout = AbortSignal.timeout(30_000);
    const signal = typeof AbortSignal.any === "function" ? AbortSignal.any([controller.signal, timeout]) : timeout;
    const token = getBearerToken();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    turnInFlight.current = true;
    try {
      const result = await consumeMindTurn({
        url: `${prefix}/api/mind/turn`,
        signal,
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: chatTurnBody({
          text,
          memory: chat.memory,
          halted: wsRef.current.halted,
          history: history.map((item) => ({
            role: item.role,
            content: item.content,
            images: item.images
              ?.filter((image) => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
              .map((image) => ({ dataUrl: image.dataUrl!, name: image.name })),
          })),
          memoryContext: memoriesForChat(source, chat).map((item) => ({ id: item.id, text: item.text })),
          provider: activeLogic ?? (isCustomProvider || otherReady ? providerChoice : (routed.ok ? routed.id : providerChoice)),
          modelTier,
          logicRoute: activeLogic,
          images: snapped.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
          personalityId: chat.personalityId ?? "assistant",
          customPersonality: chat.customPersonality ?? "",
        }),
        onDelta: (chunk) => {
          if (generation !== turnGen.current) return;
          setLiveText((current) => current + chunk);
        },
      });
      if (generation !== turnGen.current) return null;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      if (result.ok && result.provider) setNotice(`${result.provider} answered.`);
      if (!shouldStoreReply(result)) {
        const message = result.ok ? "Grok returned an empty reply." : result.error;
        if (message === STOPPED_REPLY) {
          setError(message);
          return null;
        }
        const kind = classifyHonestFailure(message);
        reportFailure(message, kind ? honestFailureAuditAction(kind) : "chat_failed", chat.id, retryThisTurn);
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
                      ...(result.memorySaved === true
                        ? {
                            memorySaved: true as const,
                            savedMemoryId: result.savedMemoryId ?? null,
                          }
                        : {}),
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
        const answered = result.provider
          ? respondedRouteLabel({
              provider: result.provider,
              model: result.model,
              requestedModel: result.requestedModel,
              credentialFallback: result.credentialFallback,
            })
          : "";
        const tierLabel = result.provider
          ? answered
          : result.model
            ? `${result.model}${result.resolvedTier || result.modelTier ? ` (${result.modelTier ?? modelTier}${autoBit})` : ""}`
            : result.model;
        if (result.resolvedTier === "Fast" || result.resolvedTier === "Expert" || result.resolvedTier === "Heavy" || result.resolvedTier === "Build") {
          setLastResolvedTier(result.resolvedTier);
        }
        if (result.model) setLastModelUsed(result.model);
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
      return result.text;
    } catch (caught) {
      if (generation !== turnGen.current) return null;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      if (controller.signal.aborted) {
        setError(STOPPED_REPLY);
        return null;
      }
      const message = normalizeClientFailureMessage(caught);
      const kind = classifyHonestFailure(message);
      reportFailure(message, kind ? honestFailureAuditAction(kind) : "chat_failed", chat.id, retryThisTurn);
      return null;
    } finally {
      turnInFlight.current = false;
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


  function downloadImageDataUrl(src: string, alt: string) {
    const link = document.createElement("a");
    const ext = src.startsWith("data:image/png") ? "png" : src.startsWith("data:image/webp") ? "webp" : "jpg";
    link.href = src;
    link.download = (alt || "image").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) + "." + ext;
    link.click();
  }

  function saveImageToComposer(src: string, alt: string) {
    if (!src.startsWith("data:image/")) {
      setError("Only in-chat data URLs can be saved back into the composer.");
      return;
    }
    setPendingImages((prev) => {
      if (prev.length >= 4) {
        setError("You can attach up to 4 images per message.");
        return prev;
      }
      return [...prev, { dataUrl: src, name: alt || `saved-${prev.length + 1}.jpg` }];
    });
    setNotice("Image saved into the composer for a follow-up turn.");
  }

  function editMessage(messageId: string, text: string) {
    if (!active || busy || turnInFlight.current) return;
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop(active.id, () => editMessage(messageId, text));
      return;
    }
    const revised = reviseUserTurn(wsRef.current, active.id, messageId, text);
    if ("error" in revised) {
      setError(revised.error);
      return;
    }
    setWs(revised.ws);
    void deliver(revised.chat, revised.text, revised.ws, true, snapshotImages(toImageAttachments(revised.images)));
  }

  function regenerate() {
    if (!active || busy || turnInFlight.current) return;
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop(active.id, () => regenerate());
      return;
    }
    const prepared = prepareRegenerate(wsRef.current, active.id);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    setWs(prepared.ws);
    void deliver(prepared.chat, prepared.text, prepared.ws, true, snapshotImages(toImageAttachments(prepared.images)));
  }

  function retryLast() {
    if (!active || busy || turnInFlight.current) return;
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop(active.id, () => retryLast());
      return;
    }
    const prepared = prepareRetry(wsRef.current, active.id);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    if (prepared.chat.messages.at(-1)?.role !== "user") return;
    setError(null);
    void deliver(prepared.chat, prepared.text, wsRef.current, true, snapshotImages(toImageAttachments(prepared.images)));
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

  async function deliverPlanned(chat: Chat, full: string, source: Workspace, images: ImageAttachment[]): Promise<void> {
    const primary = logicRoute ?? (isLogicRouteId(providerChoice) ? providerChoice : null);
    const seats = logicRoutes.map((item) => ({ id: item.id, label: item.label, ready: item.ready, reason: item.reason }));
    const plan = planRouting({ mode: routingMode, primary, seats, panel: routingPanel });
    if (!plan.ok) {
      setError(plan.reason);
      return;
    }
    setNotice(plan.note);
    for (let index = 0; index < plan.calls.length; index += 1) {
      const call = plan.calls[index];
      if (!call) return;
      const textOut = await deliver(chat, full, index === 0 ? source : wsRef.current, false, images, {
        ...(call.route ? { logicRoute: call.route } : {}),
        skipUserMessage: index > 0,
        isolateOutputs: index > 0,
      });
      if (textOut == null) return;
    }
  }

  async function sendCommand() {
    if (busy || turnInFlight.current) return;
    const text = draft.trim();
    const images = snapshotImages(pendingImages);
    const file = staged;
    const gate = canSend({ halted: wsRef.current.halted, busy });
    if (!gate.ok) {
      if (wsRef.current.halted) {
        reportEmergencyStop("command", () => {
          setDraft(text);
          if (file) setStaged(file);
          setPendingImages(images);
          void sendCommand();
        });
      } else {
        setError(gate.reason);
      }
      return;
    }
    const imaginePrompt = parseImagineCommand(text);
    if (imaginePrompt !== null) {
      if (!imaginePrompt) {
        setError("Write a prompt after /imagine.");
        return;
      }
      await runImagine(imaginePrompt, null);
      return;
    }
    const plan = commandSendPlan({
      liveHalted: wsRef.current.halted,
      text,
      imageCount: images.length,
    });
    if (plan === "empty") {
      setError("Write what you want to work on.");
      return;
    }
    if (plan === "blocked") {
      const snapshot = text;
      const heldFile = file;
      const imageSnapshot = images;
      reportEmergencyStop("command", () => {
        setDraft(snapshot);
        if (heldFile) setStaged(heldFile);
        setPendingImages(imageSnapshot);
        void sendCommand();
      });
      return;
    }
    const routePlan = planRouting({
      mode: routingMode,
      primary: logicRoute ?? (isLogicRouteId(providerChoice) ? providerChoice : null),
      seats: logicRoutes.map((item) => ({ id: item.id, label: item.label, ready: item.ready, reason: item.reason })),
      panel: routingPanel,
    });
    if (!routePlan.ok) {
      setError(routePlan.reason);
      return;
    }
    const made = createChat(ws, {
      memory: memoryChoice,
      autonomy,
      temporary,
      projectId: projectChoice || null,
      personalityId: defaultPersonalityId,
    });
    const attached = file ? `\n\nAttached file ${file.name}:\n${file.text.slice(0, 6000)}` : "";
    const full = `${text || (images.length ? "Describe the attached image." : "")}${attached}`.slice(0, 8000);
    setDraft("");
    setStaged(null);
    setPendingImages([]);
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
    const effortPath = resolveSendPath(composerEffort);
    if (effortPath.notice) setNotice(effortPath.notice);
    await deliverPlanned(made.chat, full, { ...ws, chats: [made.chat, ...ws.chats] }, images);
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
      setResearchNote(result.ok ? (result.summary || "") : result.error);
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
    setAgentImages([]);
    const plannerImages = pendingImages;
    setPendingImages([]);
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
          images: plannerImages.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
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
        images?: { dataUrl: string; name?: string; mime?: string }[];
      };
      if (controller.signal.aborted) return;
      setAgentLog(payload.log ?? []);
      const modelBit = payload.model ? ` Model ${payload.model}${payload.resolvedTier ? ` (${payload.modelTier ?? modelTier}→${payload.resolvedTier})` : ""}.` : "";
      const agentImages = (payload.images ?? [])
        .filter((image) => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
        .map((image, index) => ({
          dataUrl: image.dataUrl,
          name: image.name || `imagine-${index + 1}.jpg`,
          mime: image.mime,
        }));
      if (agentImages.length) {
        setPendingImages(agentImages);
        setAgentImages(agentImages);
      } else {
        setAgentImages([]);
      }
      setAgentNote((payload.ok ? payload.text ?? "" : payload.error || "The planner did not finish.") + (payload.ok ? modelBit : "") + (agentImages.length ? ` · ${agentImages.length} image staged for follow-up.` : ""));
      setWs((prev) => pushAudit(prev, "agent_plan", "bounded", payload.ok ? (agentImages.length ? "finished+imagine" : "finished") : "stopped"));
    } catch {
      if (controller.signal.aborted) setAgentNote("Stopped. The unfinished reply was not saved.");
      else setAgentNote("The planner did not finish. Nothing was marked finished.");
    } finally {
      if (agentAbort.current === controller) agentAbort.current = null;
      setAgentBusy(false);
    }
  }

  async function sendInChat() {
    if (busy || turnInFlight.current) return;
    if (!active) {
      void sendCommand();
      return;
    }
    const text = draft.trim();
    const images = snapshotImages(pendingImages);
    const file = staged;
    const gate = canSend({ halted: wsRef.current.halted, busy });
    if (!gate.ok) {
      if (wsRef.current.halted) {
        reportEmergencyStop(active.id, () => {
          setDraft(text);
          if (file) setStaged(file);
          setPendingImages(images);
          void sendInChat();
        });
      } else {
        setError(gate.reason);
      }
      return;
    }
    const imaginePrompt = parseImagineCommand(text);
    if (imaginePrompt !== null) {
      if (!imaginePrompt) {
        setError("Write a prompt after /imagine.");
        return;
      }
      await runImagine(imaginePrompt, active);
      return;
    }
    const plan = commandSendPlan({
      liveHalted: wsRef.current.halted,
      text: text || (file ? file.name : ""),
      imageCount: images.length,
    });
    if (plan === "empty") return;
    if (plan === "blocked") {
      const snapshot = text;
      const heldFile = file;
      const chatId = active.id;
      const imageSnapshot = images;
      reportEmergencyStop(chatId, () => {
        setDraft(snapshot);
        if (heldFile) setStaged(heldFile);
        setPendingImages(imageSnapshot);
        void sendInChat();
      });
      return;
    }
    const chatPlan = planRouting({
      mode: routingMode,
      primary: logicRoute ?? (isLogicRouteId(providerChoice) ? providerChoice : null),
      seats: logicRoutes.map((item) => ({ id: item.id, label: item.label, ready: item.ready, reason: item.reason })),
      panel: routingPanel,
    });
    if (!chatPlan.ok) {
      setError(chatPlan.reason);
      return;
    }
    const attached = file ? `\n\nAttached file ${file.name}:\n${file.text.slice(0, 6000)}` : "";
    const full = `${text || (images.length ? "Describe the attached image." : "Read the attached file.")}${attached}`.slice(0, 8000);
    setDraft("");
    setStaged(null);
    setPendingImages([]);
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
    const effortPath = resolveSendPath(composerEffort);
    if (effortPath.notice) setNotice(effortPath.notice);
    await deliverPlanned(active, full, ws, images);
  }

  async function runImagine(promptRaw?: string, targetChat: Chat | null = active, opts?: { retry?: boolean }) {
    if (imagineInFlight.current || busy) return;
    const prompt = (promptRaw ?? draft).trim();
    if (!prompt) {
      setError("Write a prompt for Imagine, or use /imagine <prompt>.");
      return;
    }
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop("imagine", () => {
        void runImagine(prompt, targetChat, opts);
      });
      return;
    }
    if (!opts?.retry) setDraft("");
    setError(null);
    setBusy(true);
    setLiveText("");
    const token = getBearerToken();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    let chat = targetChat;
    if (!chat) {
      if (opts?.retry) {
        setBusy(false);
        return;
      }
      const made = createChat(ws, {
        memory: memoryChoice,
        autonomy,
        temporary,
        projectId: projectChoice || null,
        personalityId: defaultPersonalityId,
      });
      chat = made.chat;
      setActiveId(made.chat.id);
      setView("chat");
      setWs((prev) =>
        pushAudit({ ...prev, chats: [made.chat, ...prev.chats] }, "create_chat", made.chat.id, `imagine; memory ${made.chat.memory}`),
      );
    }
    const chatId = chat.id;
    if (!opts?.retry) {
      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: `/imagine ${prompt}`,
        at: new Date().toISOString(),
      };
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chatId
            ? {
                ...item,
                title: item.messages.length ? item.title : prompt.replace(/\s+/g, " ").slice(0, 48),
                messages: [...item.messages, userMsg],
              }
            : item,
        ),
      }));
    }
    const rememberImagineFailure = (failure: ReturnType<typeof imageGenerationFailure>) => {
      const params = imagineRetryParams(failure);
      reportFailure(failure.message, failure.kind, failure.target, () => {
        const again = wsRef.current.chats.find((item) => item.id === chatId) ?? chat;
        void runImagine(params.prompt, again, { retry: true });
      });
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chatId
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant" as const,
                    content: failure.message,
                    at: new Date().toISOString(),
                  },
                ],
              }
            : item,
        ),
      }));
    };
    imagineInFlight.current = true;
    try {
      const response = await fetch(`${prefix}/api/mind/media/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, n: 1 }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        model?: string;
        images?: { dataUrl: string; mime?: string; name?: string }[];
      };
      if (!response.ok || !payload.ok || !payload.images?.length) {
        rememberImagineFailure(
          imageGenerationFailure({
            mode: "generate",
            prompt,
            status: response.status,
            serverError: payload.error || "",
            n: 1,
            target: `imagine:${chatId}`,
          }),
        );
        return;
      }
      const images: ImageAttachment[] = payload.images.map((image, index) => ({
        dataUrl: image.dataUrl,
        name: image.name || `imagine-${index + 1}.jpg`,
        mime: image.mime,
      }));
      const model = payload.model || "grok-imagine-image";
      setPendingImages(images);
      setNotice(`Imagine (${model}). Attached for a follow-up vision turn — Send or Agent to reuse.`);
      clearFailure();
      setWs((prev) => {
        const next = {
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === chatId
              ? {
                  ...item,
                  messages: [
                    ...item.messages,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant" as const,
                      content: `Generated with ${model}. The image is shown below and staged in the composer so you can Send or run Agent with it as vision input.`,
                      at: new Date().toISOString(),
                      model,
                      images: images.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
                    },
                  ],
                }
              : item,
          ),
        };
        return pushAudit(next, "imagine_generate", chatId, model);
      });
    } catch (caught) {
      const normalized = normalizeClientFailureMessage(caught);
      const kind = classifyHonestFailure(normalized);
      if (kind === "auth_required" || kind === "forbidden_cross_site" || kind === "rate_limited") {
        reportFailure(normalized, honestFailureAuditAction(kind), `imagine:${chatId}`, () => {
          const again = wsRef.current.chats.find((item) => item.id === chatId) ?? chat;
          void runImagine(prompt, again, { retry: true });
        });
        return;
      }
      rememberImagineFailure(
        imageGenerationFailure({
          mode: "generate",
          prompt,
          caughtMessage: normalized,
          n: 1,
          target: `imagine:${chatId}`,
        }),
      );
    } finally {
      imagineInFlight.current = false;
      setBusy(false);
      setLiveText("");
    }
  }

  async function runImagineEdit(imageDataUrl: string, promptRaw?: string, opts?: { retry?: boolean }) {
    if (imagineInFlight.current || busy) return;
    const prompt = (promptRaw ?? draft).trim();
    if (!prompt) {
      setError("Write an edit instruction in the composer, then press Edit with Imagine.");
      return;
    }
    if (!imageDataUrl.startsWith("data:image/")) {
      setError("Edit with Imagine only works on images kept as data URLs in this chat.");
      return;
    }
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop("imagine:edit", () => {
        void runImagineEdit(imageDataUrl, prompt, opts);
      });
      return;
    }
    if (!opts?.retry) setDraft("");
    setError(null);
    setBusy(true);
    const token = getBearerToken();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    imagineInFlight.current = true;
    try {
      const response = await fetch(`${prefix}/api/mind/media/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, image: imageDataUrl, mode: "edit", n: 1 }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        model?: string;
        images?: { dataUrl: string; mime?: string; name?: string }[];
      };
      if (!response.ok || !payload.ok || !payload.images?.length) {
        const failure = imageGenerationFailure({
          mode: "edit",
          prompt,
          status: response.status,
          serverError: payload.error || "",
          imageDataUrl,
          n: 1,
        });
        const params = imagineRetryParams(failure);
        reportFailure(failure.message, failure.kind, failure.target, () => {
          if (!params.imageDataUrl) return;
          void runImagineEdit(params.imageDataUrl, params.prompt, { retry: true });
        });
        return;
      }
      const images: ImageAttachment[] = payload.images.map((image, index) => ({
        dataUrl: image.dataUrl,
        name: image.name || `imagine-edit-${index + 1}.jpg`,
        mime: image.mime,
      }));
      setPendingImages(images);
      setNotice(`Edited with ${payload.model || "grok-imagine-image"}. Staged for Send / Agent.`);
      clearFailure();
      if (active && !opts?.retry) {
        const chatId = active.id;
        setWs((prev) => ({
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === chatId
              ? {
                  ...item,
                  messages: [
                    ...item.messages,
                    {
                      id: crypto.randomUUID(),
                      role: "user" as const,
                      content: `Edit with Imagine: ${prompt}`,
                      at: new Date().toISOString(),
                    },
                    {
                      id: crypto.randomUUID(),
                      role: "assistant" as const,
                      content: `Edited with ${payload.model || "grok-imagine-image"}.`,
                      at: new Date().toISOString(),
                      model: payload.model || "grok-imagine-image",
                      images: images.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
                    },
                  ],
                }
              : item,
          ),
        }));
      } else if (active) {
        const chatId = active.id;
        const model = payload.model || "grok-imagine-image";
        setWs((prev) => ({
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === chatId
              ? {
                  ...item,
                  messages: [
                    ...item.messages,
                    {
                      id: crypto.randomUUID(),
                      role: "assistant" as const,
                      content: `Edited with ${model}.`,
                      at: new Date().toISOString(),
                      model,
                      images: images.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
                    },
                  ],
                }
              : item,
          ),
        }));
      }
    } catch (caught) {
      const normalized = normalizeClientFailureMessage(caught);
      const failure = imageGenerationFailure({
        mode: "edit",
        prompt,
        caughtMessage: normalized,
        imageDataUrl,
        n: 1,
      });
      const params = imagineRetryParams(failure);
      reportFailure(failure.message, failure.kind, failure.target, () => {
        if (!params.imageDataUrl) return;
        void runImagineEdit(params.imageDataUrl, params.prompt, { retry: true });
      });
    } finally {
      imagineInFlight.current = false;
      setBusy(false);
    }
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

  function applyCloudAttach(item: CloudPickerAttach) {
    if (item.kind === "image") {
      setPendingImages((prev) => {
        if (prev.length >= 4) {
          setError("You can attach up to 4 images per message.");
          return prev;
        }
        return [...prev, { dataUrl: item.dataUrl, name: item.name, mime: item.mime }];
      });
      setError(null);
      return;
    }
    setStaged({ name: item.name, text: item.text });
    setError(null);
  }

  async function addImageAttachment(file: File) {
    try {
      const scaled = await fileToDownscaledDataUrl(file);
      setPendingImages((prev) => {
        if (prev.length >= 4) {
          setError("You can attach up to 4 images per message.");
          return prev;
        }
        return [...prev, { dataUrl: scaled.dataUrl, name: scaled.name, mime: scaled.mime }];
      });
      setError(null);
      let notice = `Image “${scaled.name}” staged${scaled.scaled ? " (downscaled)" : ""}. Send includes it for the model.`;
      // Keep mcp/voice analyzeImageFile path alongside media attach when the raw file is small enough.
      if (file.size <= 400_000) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          const result = await analyzeImageFile({ data: { name: file.name, bytes: file.size, imageBase64: btoa(binary) } });
          if (result.analyzed) notice = `${notice} ${result.provider} returned: ${result.text}`;
          else if (result.error) notice = `${notice} Analyze: ${result.error}`;
        } catch {
          // attach already succeeded
        }
      }
      setNotice(notice);
    } catch {
      setError("That image could not be prepared.");
    }
  }

  async function onPicked(file: File) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(file.name) || (file.type || "").startsWith("image/")) {
      await addImageAttachment(file);
      return;
    }
    if (file.size > 400_000) {
      setError("That file is too large to keep in this browser.");
      return;
    }
    if (/\.(heic)$/i.test(file.name)) {
      setError("HEIC is not supported here. Convert to JPEG or PNG first.");
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
      if (!next) return updated;
      const stopped = haltFleet(updated);
      return {
        ...stopped,
        schedules: stopped.schedules.map((job) => (job.enabled ? { ...job, enabled: false } : job)),
      };
    });
    setNotice(next
      ? "Emergency stop is on. Open runs were canceled and schedules were paused. Logs and memory were kept."
      : "Emergency stop is off. Schedules stay paused until you enable them.");
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

  function presentReportedFailure(outcome: McpReportedOutcome, auditId: string, retry: (() => void) | null) {
    const { message, action, target, kind, failureAction } = outcome;
    setWs((prev) => ({
      ...prev,
      audit: [{ id: auditId, at: new Date().toISOString(), action, target, result: message }, ...prev.audit].slice(0, 200),
    }));
   setFailure({ message, auditId, retry: onceRetry(retry), kind, action: failureAction });
    setError(null);
    setNotice(null);
  }

  useMcpFailureMount(({ outcome, retry, localCorrelationId }) => {
    presentReportedFailure(outcome, localCorrelationId, outcome.retryable ? retry : null);
  });

  function reportFailure(message: string, action: string, target: string, retry: (() => void) | null, failureAction: RouteFailureAction = "retry") {
    const kind = classifyHonestFailure(message);
    const auditAction = kind ? honestFailureAuditAction(kind) : action;
    const auditId = crypto.randomUUID();
    const surface = surfaceForReport(auditAction, target);
    const outcome: McpReportedOutcome = { message, action: auditAction, target, kind, retryable: retry !== null && failureAction === "retry", failureAction };
    if (
      surface &&
      emitFailure(
        surface,
        mountFailure(outcome, () => {
          retry?.();
        }, auditId),
      )
    ) {
      return;
    }
    presentReportedFailure(outcome, auditId, outcome.retryable ? retry : null);
  }
  reportFailureRef.current = reportFailure;

  function applyConnectedMcpRows(servers: SavedMcpServer[]) {
    setMcpServers(servers);
    setMcpSavedListState({ status: "ready", servers: servers.map((server) => ({ id: server.id, label: server.label, kind: "saved", enabled: server.state !== "failed" })) });
  }

  async function saveConnectedMcp() {
    if (ws.halted || !mcpUrl.trim() || mcpMutationInFlight.current || !mcpOwnerActive.current) return;
    mcpMutationInFlight.current = true;
    setMcpMutationBusy(true);
    const mutation = ++mcpMutationGeneration.current;
    const generation = ++mcpSavedGeneration.current;
    mcpRegistryGeneration.current += 1;
    const current = () => mcpOwnerActive.current && mutation === mcpMutationGeneration.current && generation === mcpSavedGeneration.current;
    try {
      const result = await mcpSave({ data: { label: mcpLabel, url: mcpUrl, token: mcpToken } });
      if (!current()) return;
      setMcpToken("");
      if (!result.ok) {
        reportFailure(result.error, "mcp_save_failed", "mcp:save", null, "none");
        mcpReloadListsRef.current?.();
        return;
      }
      applyConnectedMcpRows(result.servers);
      setMcpLabel("");
      setMcpUrl("");
      const saved = result.servers.find((server) => server.id === result.savedId);
      if (saved?.state === "connected") setNotice("The MCP server answered. It is connected.");
      else reportFailure(saved?.error || "The MCP handshake did not complete. The connection is saved but is not connected.", "mcp_save_failed", "mcp:save", null, "none");
      mcpReloadListsRef.current?.();
    } catch {
      if (!current()) return;
      setMcpToken("");
      reportFailure("The save could not be confirmed. Reload connections before trying another save.", "mcp_save_failed", "mcp:save", null, "none");
      mcpReloadListsRef.current?.();
    } finally {
      if (mutation === mcpMutationGeneration.current) {
        mcpMutationInFlight.current = false;
        if (mcpOwnerActive.current) setMcpMutationBusy(false);
      }
    }
  }

  async function removeConnectedMcp(id: string) {
    if (ws.halted || mcpMutationInFlight.current || !mcpOwnerActive.current) return;
    mcpMutationInFlight.current = true;
    setMcpMutationBusy(true);
    const mutation = ++mcpMutationGeneration.current;
    const generation = ++mcpSavedGeneration.current;
    mcpRegistryGeneration.current += 1;
    const current = () => mcpOwnerActive.current && mutation === mcpMutationGeneration.current && generation === mcpSavedGeneration.current;
    try {
      const result = await mcpRemove({ data: { id } });
      if (!current()) return;
      applyConnectedMcpRows(result.servers);
      mcpReloadListsRef.current?.();
    } catch {
      if (!current()) return;
      reportFailure("The removal could not be confirmed. Reload connections before trying again.", "mcp_remove_failed", "mcp:remove", null, "none");
      mcpReloadListsRef.current?.();
    } finally {
      if (mutation === mcpMutationGeneration.current) {
        mcpMutationInFlight.current = false;
        if (mcpOwnerActive.current) setMcpMutationBusy(false);
      }
    }
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
      personalityId: defaultPersonalityId,
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

  async function speakChatTurn(transcript: string) {
    let chat = (activeId ? wsRef.current.chats.find((item) => item.id === activeId) : null) ?? null;
    let source = wsRef.current;
    if (!chat) {
      const made = createChat(source, {
        memory: memoryChoice,
        autonomy,
        temporary,
        projectId: chatProjectId || projectChoice || null,
        personalityId: defaultPersonalityId,
      });
      chat = made.chat;
      source = { ...source, chats: [made.chat, ...source.chats] };
      setActiveId(made.chat.id);
      setView("chat");
      setWs((prev) => pushAudit({ ...prev, chats: [made.chat, ...prev.chats] }, "create_chat", made.chat.id, "speak"));
    }
    const reply = await deliver(chat, transcript, source);
    if (!reply) return { ok: false as const, error: "The chat turn failed. Nothing was spoken." };
    return { ok: true as const, text: reply };
  }

  async function speak(text: string, messageId = "", voiceId = voiceChoiceRef.current, replay?: SpeakRetryParams) {
    if (!replay && voiceModeRef.current === "orchestrator") {
      const probe = await probeOllamaConductor({
        baseUrl: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.base")) || undefined,
        model: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.model")) || undefined,
      });
      const route = resolveVoiceMode("orchestrator", probe.ok);
      if (route.fellBack) {
        applyVoiceMode("direct");
        setNotice(route.notice ?? DIRECT_FALLBACK_NOTICE);
      }
    }
    interruptSpeakPlayback();
    const generation = ++speakGenRef.current;
    const abort = new AbortController();
    speakAbortRef.current = abort;
    setSpeaking(true);
    setAvatarPresence("processing");
    let speechFailed = false;
    await runMountedSpeak({
      text,
      messageId,
      voiceId,
      replay,
      isCurrent: () => generation === speakGenRef.current && !abort.signal.aborted,
      deps: {
        capture: () => captureSpeakUtterance({ maxMs: 6000, signal: abort.signal }),
        transcribe: async (audioBase64) => {
          const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
          const token = getBearerToken();
          const response = await fetch(`${prefix}/api/mind/voice/stt`, {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: abort.signal,
            body: JSON.stringify({ audioBase64, mime: "audio/webm", filename: "speak.webm" }),
          });
          try {
            const body = (await response.json()) as { ok?: boolean; text?: string; error?: string; provider?: string };
            if (body.ok && body.provider) setNotice(`${body.provider} transcribed this.`);
            return body;
          } catch {
            return { ok: false, error: "The transcript request failed. Nothing was substituted." };
          }
        },
        chatTurn: (transcript) => speakChatTurn(transcript),
        synthesize: async (reply, voice) => {
          noteSpokenText(reply);
          const spoken = await speakText({ data: { text: reply, voiceId: voice } });
          if (spoken && typeof spoken === "object" && "ok" in spoken && spoken.ok && "provider" in spoken && spoken.provider) {
            setNotice(`${spoken.provider} spoke this reply.`);
          }
          return spoken;
        },
        play: async (audio) => {
          await sharedAudioOutput.playMpegBase64(audio);
        },
      },
      reportFailure: (message, action, target, retry) => {
        speechFailed = true;
        setAvatarPresence("error");
        reportFailure(message, action, target, retry);
        setFailure((current) => (current ? { ...current, kind: (classifyHonestFailure(message) ?? (action as HonestFailureKind)) } : current));
      },
      clearFailure,
      again: (params) => {
        void speak(params.text, params.messageId, resolveXaiVoiceId(params.voiceId), params);
      },
    });
    if (generation !== speakGenRef.current || abort.signal.aborted) return;
    setSpeaking(false);
    if (!speechFailed && !wsRef.current.halted) setAvatarPresence("idle");
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
    noteSpokenText(clipped);
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
    clearStageTimeout();
    voiceActiveRef.current = false;
    speakQueueRef.current.active = null;
    speakQueueRef.current.pending = null;
    voiceMutedRef.current = false;
    interruptSpeakPlayback();
    listenMintAbortRef.current?.abort();
    listenMintAbortRef.current = null;
    voiceSession.current?.close();
    voiceSession.current = null;
    setVoiceListening(false);
    setVoiceMuted(false);
    setVoiceLevel(0);
    setVoiceLiveTranscript("");
    listenGuardRef.current.end();
    bargeRef.current = createBargeInState();
    holdInterruptedRef.current = false;
  }

  function toggleVoiceMute() {
    const desired = toggleMute(voiceMutedRef.current);
    const decided = nextMuteState(voiceMutedRef.current, desired);
    if (!decided.changed) return;
    voiceMutedRef.current = decided.muted;
    setVoiceMuted(decided.muted);
    voiceSession.current?.setMuted(decided.muted);
    const message = decided.muted ? "Microphone muted. Listening session stays open." : "Microphone unmuted.";
    setNotice(message);
    if (overlayOpenRef.current) setOverlayNotice(message);
  }

  async function handleVoiceTranscript(transcript: string) {
    if (!shouldAcceptTranscript(transcriptDedupeRef.current, transcript)) return;
    const sanitized = sanitizeVoiceTranscript(transcript);
    if (!sanitized.ok) {
      setNotice(sanitized.error);
      return;
    }
    const text = sanitized.text;
    if (overlayOpenRef.current) {
      const routed = routeVoiceModeTranscript(text);
      setVoiceLiveTranscript(clampLiveTranscript(routed.overlayTranscript));
      // Empty composerDraft means the transcript stays out of the composer. Do not wipe text the user already typed.
      if (routed.composerDraft) setDraft(routed.composerDraft);
      if (!routed.sendAsChatTurn) return;
      setOverlayNotice("Heard you. This realtime turn goes to chat, not the composer.");
    } else {
      setDraft(text);
      voiceNext.current = true;
      setNotice(`Voice transcript ready (${voiceModeRef.current === "orchestrator" ? "Orchestrator" : "Direct"}).`);
    }
    if (voiceModeRef.current === "orchestrator") {
      setBusy(true);
      const conducted = await runOllamaConductor(text, {
        baseUrl: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.base")) || undefined,
        model: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.model")) || undefined,
      });
      setBusy(false);
      if (!conducted.ok) {
        if (!conducted.unreachable) {
          setError(conducted.error);
          return;
        }
        const route = resolveVoiceMode("orchestrator", false);
        applyVoiceMode("direct");
        const notice = route.notice ?? DIRECT_FALLBACK_NOTICE;
        setNotice(notice);
        if (overlayOpenRef.current) setOverlayNotice(notice);
      } else {
      if (active) {
        const turn = buildVoiceChatTurn({
          userText: text,
          assistantText: conducted.text,
          model: conducted.model,
        });
        if (turn) {
          setWs((prev) =>
            pushAudit(
              {
                ...prev,
                chats: prev.chats.map((item) =>
                  item.id === active.id ? { ...item, messages: [...item.messages, turn.user, turn.assistant] } : item,
                ),
              },
              "message_sent",
              active.id,
              conducted.model,
            ),
          );
        }
      }
      speakOnOpenSession(conducted.text);
      return;
      }
    }
    if (!active) {
      setNotice("Open or create a chat so Direct mode can send the transcript to the selected model.");
      if (overlayOpenRef.current) {
        setOverlayNotice("Open or create a chat so Direct mode can send the transcript to the selected model.");
      }
      return;
    }
    if (ws.halted || busy) return;
    const reply = await deliver(active, text, ws);
    if (reply) speakOnOpenSession(reply);
  }

  function clearStageTimeout() {
    stageGenRef.current += 1;
    if (stageTimerRef.current) {
      window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = 0;
    }
  }

  function armStageTimeout(stage: Exclude<VoiceConnectStage, "error" | "idle" | "listening">) {
    const gen = ++stageGenRef.current;
    if (stageTimerRef.current) window.clearTimeout(stageTimerRef.current);
    if (!overlayOpenRef.current) return;
    stageTimerRef.current = window.setTimeout(() => {
      if (gen !== stageGenRef.current) return;
      if (!overlayOpenRef.current) return;
      const message = stageTimeoutMessage(stage);
      const failed = failStage(stage, message);
      connectStateRef.current = failed;
      setOverlayPhase("error");
      setOverlayError(failed.error);
      setError(message);
      stopVoiceSession();
    }, VOICE_STAGE_TIMEOUT_MS);
  }

  function publishConnectStage(stage: Exclude<VoiceConnectStage, "error">) {
    const entered = enterStage(stage);
    connectStateRef.current = entered;
    if (!overlayOpenRef.current) return;
    if (stage === "listening" || stage === "idle") {
      clearStageTimeout();
      setOverlayError(null);
      setOverlayPhase(stage === "listening" ? "listening" : "idle");
      return;
    }
    setOverlayPhase(stage);
    armStageTimeout(stage);
  }

  function noteConnectFailure(stage: VoiceConnectStage, message: string) {
    clearStageTimeout();
    voiceActiveRef.current = false;
    const normalized = normalizeVoiceConnectError(new Error(message));
    const shown = /sign in/i.test(normalized) ? normalized : message;
    const failed = failStage(stage, shown);
    connectStateRef.current = failed;
    setError(shown);
    setVoiceListening(false);
    if (overlayOpenRef.current) {
      setOverlayPhase("error");
      setOverlayError(failed.error);
    }
  }

  function pushBarge(action: BargeInAction) {
    const prev = bargeRef.current;
    const next = reduceBargeIn(prev, action);
    bargeRef.current = next;
    if (!shouldCutPlayback(prev, next)) return next;
    interruptSpeakPlayback();
    voiceSession.current?.interruptPlayback();
    holdInterruptedRef.current = true;
    if (overlayOpenRef.current) setOverlayPhase("interrupted");
    window.setTimeout(() => {
      if (!holdInterruptedRef.current) return;
      holdInterruptedRef.current = false;
      bargeRef.current = reduceBargeIn(bargeRef.current, { type: "resume_listening" });
      if (overlayOpenRef.current && voiceSession.current?.isOpen) setOverlayPhase("listening");
    }, SPEAKING_MIN_VISIBLE_MS);
    return next;
  }

  function speakOnOpenSession(text: string) {
    const session = voiceSession.current;
    if (!session?.isOpen) {
      void speak(text);
      return;
    }
    const decision = enqueueSpeak(speakQueueRef.current, text);
    if (decision === "start") session.speakText(text);
  }

  function commitDictation(action: DictationAction, announce = true) {
    const prev = { ...dictationRef.current, draft: draftRef.current };
    let next = reduceDictation(prev, action);
    if (action.type === "stop_inserted") {
      next = { ...next, draft: appendDictationText(draftRef.current, action.text) };
    }
    dictationRef.current = next;
    setDictation(next);
    if (next.draft !== draftRef.current) {
      draftRef.current = next.draft;
      setDraft(next.draft);
    }
    if (announce && next.status && next.status !== prev.status) {
      setNotice(`${next.status} Browser speech, not a realtime voice session.`);
    }
    return next;
  }

  function cancelBrowserDictation(announce = true) {
    const rec = dictationRecRef.current;
    dictationRecRef.current = null;
    dictationBufferRef.current = "";
    userStoppedDictationRef.current = true;
    try {
      rec?.abort?.();
    } catch {
      /* ignore */
    }
    try {
      rec?.stop();
    } catch {
      /* ignore */
    }
    if (dictationRef.current.phase !== "idle") commitDictation({ type: "cancel" }, announce);
    setDictationLevel(0);
  }

  function stopBrowserDictation() {
    if (dictationRef.current.phase !== "recording") return;
    userStoppedDictationRef.current = true;
    const rec = dictationRecRef.current;
    dictationRecRef.current = null;
    try {
      rec?.stop();
    } catch {
      /* ignore */
    }
    commitDictation({ type: "stop_begin" }, false);
    window.setTimeout(() => {
      if (dictationRef.current.phase !== "transcribing") return;
      const text = dictationBufferRef.current.trim();
      dictationBufferRef.current = "";
      const peak = dictationRef.current.peakLevel;
      setDictationLevel(0);
      if (!text && peak < DICTATION_SILENCE_PEAK) {
        commitDictation({ type: "stop_silent" });
        return;
      }
      if (!text) {
        commitDictation({ type: "stop_empty" });
        return;
      }
      commitDictation({ type: "stop_inserted", text });
    }, 220);
  }

  function voiceCanStart() {
    if (wsRef.current.halted) { setError("Emergency stop is on. Voice was not started."); return false; }
    const host = typeof window === "undefined" ? "" : window.location.hostname;
    const localPreview = host === "127.0.0.1" || host === "localhost";
    if (statusSignedIn !== true && !localPreview) { setVoiceSignInNotice(true); return false; }
    return true;
  }

  function startBrowserDictation() {
    if (!voiceCanStart()) return;
    // Browser SpeechRecognition only. Recorder capture in dictation.ts and server stt.ts stay unwired:
    // no transcribe server fn exists, and a new xAI STT call would be a live provider call.
    if (wsRef.current.halted) {
      setError("Emergency stop is on. Dictation was not started.");
      return;
    }
    if (
      overlayOpenRef.current ||
      voiceActiveRef.current ||
      voiceSession.current?.isOpen ||
      voiceSession.current?.isCapturing ||
      isLiveVoiceOccupied()
    ) {
      setNotice("End live voice before dictation. Dictation is browser speech, not a realtime voice session.");
      return;
    }
    if (dictationRef.current.phase !== "idle") return;
    const testText = dictationTranscriptForTestAudio(new URLSearchParams(window.location.search).get("voiceTestAudio"));
    if (testText) {
      commitDictation({ type: "stop_inserted", text: testText });
      setDictationLevel(0);
      setNotice("Test clip inserted into the composer. Browser speech path, not a realtime voice provider. Nothing was sent.");
      return;
    }
    const Ctor = browserSpeechCtor();
    if (!Ctor) {
      commitDictation({
        type: "stop_error",
        message: "This browser has no speech recognition. Nothing was transcribed. This is browser speech, not a realtime voice provider.",
      });
      setDictationLevel(0);
      return;
    }
    commitDictation({ type: "start" });
    setDictationLevel(0.2);
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    dictationBufferRef.current = "";
    userStoppedDictationRef.current = false;
    rec.onresult = (event) => {
      let finalText = "";
      let interim = "";
      const results = event.results;
      for (let i = 0; i < results.length; i++) {
        const row = results[i];
        const transcript = row?.[0]?.transcript ?? "";
        if (row?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      dictationBufferRef.current = `${finalText} ${interim}`.trim();
      if (dictationBufferRef.current) {
        setDictationLevel(0.45);
        commitDictation({ type: "level", level: 0.45 }, false);
      }
    };
    rec.onerror = (event) => {
      const code = event.error || "";
      if (code === "no-speech" || code === "aborted") return;
      userStoppedDictationRef.current = true;
      dictationRecRef.current = null;
      setDictationLevel(0);
      commitDictation({
        type: "stop_error",
        message: "Browser speech failed. Nothing was inserted. This is not a realtime voice provider.",
      });
    };
    rec.onend = () => {
      if (userStoppedDictationRef.current) return;
      if (dictationRef.current.phase !== "recording") return;
      stopBrowserDictation();
    };
    dictationRecRef.current = rec;
    try {
      rec.start();
    } catch {
      dictationRecRef.current = null;
      setDictationLevel(0);
      commitDictation({
        type: "stop_error",
        message: "Browser speech could not start. Nothing was transcribed. This is not a realtime voice provider.",
      });
    }
  }

  function onDictationMic() {
    if (dictationRef.current.phase === "recording") {
      void finishServerDictation();
      return;
    }
    if (dictationRef.current.phase === "transcribing") return;
    void startServerDictation();
  }

  async function startServerDictation() {
    if (wsRef.current.halted) {
      setError("Emergency stop is on. Dictation was not started.");
      return;
    }
    if (overlayOpenRef.current || voiceActiveRef.current || voiceSession.current?.isOpen || isLiveVoiceOccupied()) {
      setNotice("End Speak before the mic. The mic only inserts words. It does not talk back.");
      return;
    }
    try {
      const recorder = await createDictationRecorder();
      serverDictationRef.current = recorder;
      await recorder.start();
      commitDictation({ type: "start" });
      setNotice("Listening. Press the mic again to insert the words. Send is separate.");
    } catch {
      serverDictationRef.current = null;
      startBrowserDictation();
    }
  }

  async function finishServerDictation() {
    const recorder = serverDictationRef.current;
    if (!recorder) {
      stopBrowserDictation();
      return;
    }
    serverDictationRef.current = null;
    commitDictation({ type: "stop_begin" }, false);
    try {
      const captured = await recorder.stop();
      if (captured.blob.size < 32) {
        commitDictation({ type: "stop_empty" });
        setNotice("No words were caught. Press the mic, speak, then press it again.");
        return;
      }
      const audioBase64 = await blobToBase64(captured.blob);
      const mime = captured.mime.split(";")[0] || "audio/webm";
      const response = await fetch("/api/mind/voice/stt", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audioBase64, mime, filename: mime.includes("mp4") ? "dictation.m4a" : "dictation.webm" }),
      });
      const body = await response.json() as { ok?: boolean; text?: string; error?: string };
      const text = body.text?.trim() ?? "";
      if (response.ok && body.ok && text) {
        commitDictation({ type: "stop_inserted", text });
        setNotice("Words inserted into the field. Press Send when you want a reply.");
        return;
      }
      commitDictation({ type: "stop_error", message: body.error || "Nothing was transcribed." });
    } catch {
      commitDictation({ type: "stop_error", message: "Dictation could not finish. Nothing was inserted." });
    }
  }

  function closeVoiceOverlay() {
    overlayOpenRef.current = false;
    setVoiceOverlayOpen(false);
    setOverlayPhase("idle");
    setOverlayError(null);
    setOverlayNotice(null);
    holdInterruptedRef.current = false;
    clearStageTimeout();
    bargeRef.current = createBargeInState();
    stopVoiceSession();
    setNotice("Voice mode closed. Realtime session stopped.");
  }

  function interruptVoiceOverlay() {
    pushBarge({ type: "manual_interrupt" });
  }

  async function openVoiceOverlay() {
    if (!voiceCanStart()) return;
    if (isLiveVoiceOccupied()) {
      setNotice(LIVE_VOICE_BUSY_MESSAGE);
      return;
    }
    cancelBrowserDictation(false);
    overlayOpenRef.current = true;
    setVoiceOverlayOpen(true);
    setOverlayError(null);
    if (voiceSession.current?.isOpen || voiceActiveRef.current || listenMintAbortRef.current) {
      setOverlayPhase(bargeRef.current.phase === "speaking" ? "speaking" : "listening");
      setOverlayNotice("Realtime voice session. Not browser dictation.");
      return;
    }
    if (!allowCancel(voiceCancelBudgetRef.current)) {
      setOverlayNotice("Too many voice mode starts. Wait a moment.");
      setNotice("Too many voice mode starts. Wait a moment.");
      return;
    }
    setOverlayNotice("Realtime voice session. Not browser dictation.");
    setOverlayPhase("idle");
    holdInterruptedRef.current = false;
    bargeRef.current = createBargeInState();
    await listen({ mode: "start" });
  }

  async function retryVoiceOverlay() {
    if (!voiceCanStart()) return;
    if (!allowCancel(voiceCancelBudgetRef.current)) {
      setOverlayNotice("Too many voice retries. Wait a moment.");
      return;
    }
    if (isLiveVoiceOccupied()) {
      setOverlayNotice(LIVE_VOICE_BUSY_MESSAGE);
      return;
    }
    stopVoiceSession();
    overlayOpenRef.current = true;
    setVoiceOverlayOpen(true);
    setOverlayError(null);
    setOverlayPhase("idle");
    holdInterruptedRef.current = false;
    bargeRef.current = createBargeInState();
    await listen({ mode: "start" });
  }

  async function listen(opts?: { mode?: "toggle" | "start" | "stop" }) {
    const mode = opts?.mode ?? "toggle";
    const sessionBusy = Boolean(
      voiceActiveRef.current ||
        voiceSession.current?.isOpen ||
        voiceSession.current?.isCapturing ||
        listenMintAbortRef.current,
    );
    const action = resolveListenAction(mode, sessionBusy);
    if (action === "start" && isLiveVoiceOccupied()) {
      setNotice(LIVE_VOICE_BUSY_MESSAGE);
      if (overlayOpenRef.current) setOverlayNotice(LIVE_VOICE_BUSY_MESSAGE);
      return;
    }
    if (action === "stop") {
      stopVoiceSession();
      listenGuardRef.current.end();
      setNotice("Voice capture stopped.");
      if (overlayOpenRef.current) {
        setOverlayPhase("idle");
        setOverlayNotice("Voice capture stopped.");
      }
      return;
    }
    if (action === "start" && !voiceCanStart()) return;
    if (action === "ignore") {
      // Already listening or minting — do not toggle-stop (fixes reconnect/PTT race).
      return;
    }
    if (!listenGuardRef.current.begin()) {
      setNotice("Voice is already starting. Wait a moment.");
      return;
    }
    const flight = beginFlight(flightGateRef.current);
    if (!flight) {
      listenGuardRef.current.end();
      setNotice("Voice is already starting. Wait a moment.");
      return;
    }
    // Cut message-level Speak / TTS / browser speech before opening the mic.
    interruptSpeakPlayback();
    if (ws.halted) {
      endFlight(flightGateRef.current, flight.generation);
      listenGuardRef.current.end();
      const haltedMessage = "Emergency stop is on. Voice was not started.";
      setError(haltedMessage);
      if (overlayOpenRef.current) {
        const failed = failStage("idle", haltedMessage);
        connectStateRef.current = failed;
        setOverlayPhase("error");
        setOverlayError(failed.error);
      }
      return;
    }
    setError(null);
    setNotice(null);
    if (overlayOpenRef.current) setOverlayError(null);
    // Close any stale session before minting a new secret (spam / race).
    voiceSession.current?.close();
    voiceSession.current = null;
    voiceActiveRef.current = true;

    const markCanceled = () => {
      if (connectStateRef.current.stage === "error") {
        voiceActiveRef.current = false;
        setVoiceListening(false);
        return;
      }
      clearStageTimeout();
      voiceActiveRef.current = false;
      setNotice("Voice start canceled.");
      setVoiceListening(false);
      if (overlayOpenRef.current) {
        setOverlayPhase("idle");
        setOverlayNotice("Voice start canceled.");
      }
    };

    try {
      if (voiceModeRef.current === "orchestrator") {
        const probe = await probeOllamaConductor({
          baseUrl: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.base")) || undefined,
          model: (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.model")) || undefined,
        });
        const route = resolveVoiceMode("orchestrator", probe.ok);
        if (route.fellBack) {
          applyVoiceMode("direct");
          const notice = route.notice ?? DIRECT_FALLBACK_NOTICE;
          setNotice(notice);
          if (overlayOpenRef.current) setOverlayNotice(notice);
        }
      }

      publishConnectStage("getting_session");
      listenMintAbortRef.current?.abort();
      const mintAbort = new AbortController();
      listenMintAbortRef.current = mintAbort;
      setNotice("Minting voice session… (press mic or release Space to cancel)");

      let secret: Awaited<ReturnType<typeof createVoiceClientSecret>>;
      try {
        secret = await withSessionTimeout(() => createVoiceClientSecret(), undefined, mintAbort.signal);
        if (mintAbort.signal.aborted) {
          markCanceled();
          return;
        }
      } catch (caught) {
        if (mintAbort.signal.aborted) {
          markCanceled();
          return;
        }
        noteConnectFailure("getting_session", normalizeVoiceConnectError(caught) || formatVoiceClientError(caught));
        return;
      }
      if (!secret || typeof secret !== "object" || !("ok" in secret)) {
        noteConnectFailure("getting_session", formatVoiceClientError(secret));
        return;
      }
      if (secret.ok) {
        const expiresAt = "expiresAt" in secret && typeof secret.expiresAt === "number" ? secret.expiresAt : 0;
        if (expiresAt > 0 && secretNeedsRemint(expiresAt) && !mintAbort.signal.aborted) {
          setNotice("Voice secret is near expiry. Minting a fresh session…");
          try {
            secret = await withSessionTimeout(() => createVoiceClientSecret(), undefined, mintAbort.signal);
          } catch (caught) {
            if (mintAbort.signal.aborted) {
              markCanceled();
              return;
            }
            noteConnectFailure("getting_session", normalizeVoiceConnectError(caught) || formatVoiceClientError(caught));
            return;
          }
        }
      }
      if (mintAbort.signal.aborted) {
        markCanceled();
        return;
      }
      if (!secret || typeof secret !== "object" || !("ok" in secret)) {
        noteConnectFailure("getting_session", formatVoiceClientError(secret));
        return;
      }
      if (!secret.ok) {
        noteConnectFailure("getting_session", formatVoiceClientError(secret));
        return;
      }

      publishConnectStage("connecting");
      const voiceChat = wsRef.current.chats.find((item) => item.id === activeId) ?? null;
      const voiceBuilt = voiceSessionInstructions({
        mode: getVoiceMode(),
        personalityId: voiceChat?.personalityId ?? "assistant",
        customPersonality: voiceChat?.customPersonality ?? "",
        characterId: readStoredCharacterId(typeof localStorage === "undefined" ? null : localStorage),
      });
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
            if (overlayOpenRef.current) {
              pushBarge({ type: "speech_started" });
              return;
            }
            interruptSpeakPlayback();
            session.interruptPlayback();
          },
          onError: (message) => {
            setAvatarPresence("error");
            const shown = message || "Voice realtime error.";
            setError(shown);
            if (overlayOpenRef.current) {
              const failed = failStage(connectStateRef.current.stage, shown);
              connectStateRef.current = failed;
              setOverlayPhase("error");
              setOverlayError(failed.error);
            }
          },
          onStatus: (status) => {
            const previous = lastSessionStatusRef.current;
            lastSessionStatusRef.current = status;
            setVoiceListening(status === "listening" || status === "processing" || status === "connecting");
            if (status === "processing") setAvatarPresence("processing");
            if (status === "speaking") {
              setSpeaking(true);
              if (readAvatarSession().utterance) setAvatarPresence("speaking");
            }
            if (status === "listening") setAvatarPresence("listening");
            if (status === "idle" || status === "listening" || status === "closed") setSpeaking(false);
            if (status === "idle" || status === "closed") {
              if (!wsRef.current.halted) setAvatarPresence("idle");
              setVoiceLevel(0);
              if (status === "closed") setVoiceLiveTranscript("");
            }
            if (overlayOpenRef.current) {
              if (status === "speaking") {
                holdInterruptedRef.current = false;
                if (bargeRef.current.phase !== "speaking") pushBarge({ type: "session_speaking" });
                setOverlayPhase("speaking");
              } else if (status === "processing") {
                setOverlayPhase((phase) => (phase === "speaking" || phase === "interrupted" ? phase : "processing"));
              } else if (status === "connecting") {
                setOverlayPhase("connecting");
              } else if (status === "listening") {
                if (!holdInterruptedRef.current) {
                  if (bargeRef.current.phase !== "listening") pushBarge({ type: "session_listening" });
                  setOverlayPhase("listening");
                }
              } else if (status === "idle" || status === "closed") {
                pushBarge({ type: "session_idle" });
              }
            }
            if (previous === "speaking" && status !== "speaking") {
              const nextSpeak = completeSpeak(speakQueueRef.current);
              if (nextSpeak && voiceSession.current?.isOpen && status !== "closed" && status !== "idle") {
                voiceSession.current.speakText(nextSpeak);
              } else if (nextSpeak) {
                speakQueueRef.current.active = null;
              }
            }
          },
          onLevel: (level) => {
            setVoiceLevel(level);
            if (!overlayOpenRef.current) return;
            const now = performance.now();
            const dt = lastLevelAtRef.current ? now - lastLevelAtRef.current : 0;
            lastLevelAtRef.current = now;
            pushBarge({ type: "local_rms", level, dtMs: dt });
          },
          onUnexpectedClose: () => {
            clearStageTimeout();
            voiceActiveRef.current = false;
            listenGuardRef.current.end();
            setVoiceListening(false);
            setVoiceLevel(0);
            setVoiceLiveTranscript("");
            setSpeaking(false);
            setError(VOICE_CONNECTION_DROPPED);
            setNotice(VOICE_CONNECTION_DROPPED);
            if (overlayOpenRef.current) {
              const failed = failStage("connecting", VOICE_CONNECTION_DROPPED);
              connectStateRef.current = failed;
              setOverlayPhase("error");
              setOverlayError(failed.error ?? VOICE_CONNECTION_DROPPED);
            }
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
        { voice: voiceChoiceRef.current, instructions: voiceBuilt.instructions },
      );
      voiceSession.current = session;
      await session.connect(secret.value);
      if (mintAbort.signal.aborted) {
        session.close();
        voiceSession.current = null;
        markCanceled();
        return;
      }
      publishConnectStage("requesting_mic");
      await session.startCapture();
      publishConnectStage("listening");
      setVoiceListening(true);
      voiceReconnectRef.current = 0;
      listenMintAbortRef.current = null;
      const modeLabel = voiceModeRef.current === "orchestrator" ? "Orchestrator" : "Direct";
      setNotice(`Realtime voice listening (${modeLabel}). Hold Space or press mic to stop.`);
      if (overlayOpenRef.current) setOverlayNotice(`Realtime voice listening (${modeLabel}).`);
    } catch (caught) {
      stopVoiceSession();
      const normalized = normalizeVoiceConnectError(caught);
      const mic = formatMicCaptureError(caught);
      const message = /sign in/i.test(normalized) ? normalized : mic || normalized || formatVoiceClientError(caught);
      const stage = connectStateRef.current.stage === "idle" ? "connecting" : connectStateRef.current.stage;
      const failed = failStage(stage, message);
      connectStateRef.current = failed;
      setError(message);
      if (overlayOpenRef.current) {
        setOverlayPhase("error");
        setOverlayError(failed.error);
      }
    } finally {
      endFlight(flightGateRef.current, flight.generation);
      if (!voiceSession.current?.isOpen) {
        voiceActiveRef.current = false;
        listenGuardRef.current.end();
      }
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
  const mcpBoard =
    mcpSavedListState.status === "loading"
      ? { state: "Checking", detail: "Loading MCP servers…" }
      : mcpSavedListState.status === "error"
        ? { state: "Unavailable", detail: mcpSavedListState.message }
        : mcpServers.some((server) => server.state === "connected")
          ? { state: "Connected", detail: `${mcpServers.filter((server) => server.state === "connected").length} MCP server answered. Tools are only the ones it returned.` }
          : { state: "Not connected", detail: mcpServers.find((server) => server.error)?.error || "No MCP server has answered a handshake. Nothing is called." };
  closeVoiceOverlayRef.current = closeVoiceOverlay;
  cancelDictationRef.current = cancelBrowserDictation;
  const dictationDisabled = ws.halted || voiceListening || voiceOverlayOpen;

  return (
    <div className="shell flex h-dvh flex-col bg-bg text-fg md:flex-row" data-view={view} data-search={paletteOpen ? "open" : "closed"}>
      <aside ref={navDrawerRef} onMouseDown={closeNavFromBackdrop} role={navOpen ? "dialog" : undefined} aria-modal={navOpen ? true : undefined} aria-label={navOpen ? "Workspace navigation" : undefined} className={`rail gpt-rail ${navOpen ? "nav-drawer-open flex" : "hidden"} fixed inset-0 z-40 w-full flex-col md:static md:flex md:h-dvh ${railCollapsed ? "md:w-[4.5rem]" : "md:w-72"} md:shrink-0`}>
        <div className="gpt-rail-head flex items-center gap-3 px-4 py-4">
          {!railCollapsed && (
            <p className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-semibold tracking-tight">
              <img className="service-mark" src="/brand/marks/adrian.png" alt="" width={28} height={28} />
              Adrian
            </p>
          )}
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full bg-white/8"
            aria-label="Search workspace"
            onClick={() => {
              setPaletteOpen(true);
              setNavOpen(false);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            <Search className="size-4" />
          </button>
          <button ref={navCloseRef} type="button" className="grid size-11 place-items-center rounded-full bg-white/8 md:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)}>
            <span className="text-lg">×</span>
          </button>
          <button type="button" className="hidden size-11 place-items-center rounded-full bg-white/8 md:grid" aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setRailCollapsed((value) => !value)}>
            <PanelLeft className="size-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-auto px-3 pb-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              {!railCollapsed && <p className="meta-label px-3 pb-2">{group.label}</p>}
              <div className="space-y-1">
                {group.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  const on = view === item.id;
                  const button = (
                    <button
                      key={item.id}
                      type="button"
                      title={item.label}
                      aria-label={item.label}
                      aria-current={on ? "page" : undefined}
                      onClick={() => {
                        setView(item.id);
                        setNavOpen(false);
                        closeMenus();
                      }}
                      className={`nav-item flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium ${on ? "nav-item-active" : "text-muted hover:bg-white/5"} ${railCollapsed ? "justify-center px-0" : ""}`}
                    >
                      {NAV_ICON_SRC[item.id] ? <img className="service-mark" src={NAV_ICON_SRC[item.id]} alt="" width={22} height={22} /> : <Icon className="size-4 shrink-0 opacity-90" />}
                      {!railCollapsed && item.label}
                    </button>
                  );
                  return button;
                })}
              </div>
            </div>
          ))}
          <Link
            to="/explore"
            data-testid="nav-route-explore"
            className={`nav-item flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted ${railCollapsed ? "justify-center" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <img className="service-mark" src="/brand/marks/explore.png" alt="" width={22} height={22} />
            {!railCollapsed && "Explore"}
          </Link>
          <Link to="/dashboard" data-testid="nav-route-dashboard" className="nav-route-link sr-only">Dashboard</Link>
          {!railCollapsed && <div className="mx-3 my-3 border-t border-white/10" />}
          {ws.pins.length > 0 && !railCollapsed && (
            <div className="mb-3">
              <p className="px-3 pb-1 text-xs font-medium text-muted">Pinned</p>
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
              <p className="px-3 pb-1 text-xs font-medium text-muted">Recent</p>
              {getRecentChats(ws.chats, 5, new Set(ws.pins.filter((pin) => pin.kind === "chat").map((pin) => pin.ref))).map((chat) => (
                <div key={chat.id} className="flex min-h-11 items-center">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate rounded-2xl px-3 text-left text-sm text-muted"
                    onClick={() => {
                      setActiveId(chat.id);
                      setView("chat");
                      setNavOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <img src="/brand/marks/recent.png" alt="" width={18} height={18} className="size-4 shrink-0 rounded" />
                      <span className="truncate">{chat.title}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-white/5"
                    aria-label={`Pin ${chat.title}`}
                    onClick={() => setWs((prev) => togglePin(prev, "chat", chat.id))}
                  >
                    <Pin className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {ws.chats.length === 0 && !railCollapsed && (
            <div className="mx-3 rounded-2xl border border-white/8 bg-[#141416] p-3">
              <p className="text-sm font-medium">No chats yet</p>
              <p className="mt-1 text-sm text-muted">Start one from Chat. Recent threads stay in this menu.</p>
            </div>
          )}
          {!railCollapsed && (
            <button type="button" className="nav-item mt-3 flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm text-muted" onClick={() => { setView("settings"); setSettingsPane("pages"); setNavOpen(false); }}>
              <img src="/brand/marks/pages.png" alt="" width={22} height={22} className="size-5 rounded-md" />
              <span>All pages</span>
            </button>
          )}
        </nav>
        <div className={`gpt-rail-foot shrink-0 bg-bg p-3 ${railCollapsed ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-3"}`}>
          <button
            type="button"
            className="gpt-chat-pill inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2f6bff] px-4 text-sm font-semibold text-white"
            aria-label="Chat"
            onClick={() => {
              setView("command");
              setNavOpen(false);
            }}
          >
            <MessageSquare className="size-4" />
            {!railCollapsed && "Chat"}
          </button>
          <button
            type="button"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white/8"
            aria-label="Open Settings"
            title="Settings"
            onClick={() => {
              setView("settings");
              setSettingsPane(null);
              setNavOpen(false);
              closeMenus();
            }}
          >
            <img src="/brand/marks/settings.png" alt="" width={28} height={28} className="size-7 rounded-full object-cover" />
          </button>
        </div>
      </aside>

      <div className="main-stage page-enter flex min-h-0 min-w-0 flex-1 flex-col pb-36 md:pb-36" inert={navOpen}>
        <header className="topbar flex items-center gap-2 px-3 py-3 md:gap-3 md:px-5">
          <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel border border-line md:hidden" aria-label="Open menu" onClick={openNav}>
            <Menu className="size-4" />
          </button>
          <p className="hidden items-center gap-2 text-sm font-semibold md:flex">
            <img src={view === "command" ? "/brand/marks/chat.png" : NAV_ICON_SRC[view] ?? "/brand/marks/adrian.png"} alt="" width={22} height={22} className="size-5 rounded-md" />
            {TITLES[view]}
          </p>
          <button type="button" className="header-voice-mode inline-flex items-center gap-1" onClick={() => applyVoiceMode(toggleVoiceMode(voiceMode))} aria-label={`Switch voice mode (currently ${voiceMode})`}>
            {voiceMode === "direct" ? <img src="/brand/marks/direct.png" alt="" width={16} height={16} className="size-4 rounded" /> : null}
            {voiceMode === "direct" ? "Direct" : "Orchestrator"}
          </button>
          <div className="command-search relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPaletteIndex(0);
                setPaletteOpen(true);
              }}
              onFocus={() => setPaletteOpen(true)}
              onKeyDown={onPaletteKeyDown}
              placeholder="Search or jump…"
              className="input-glow h-11 w-full rounded-panel border border-line bg-surface/80 pr-14 pl-10 text-sm backdrop-blur"
              role="combobox"
              aria-label="Search"
              aria-keyshortcuts="Control+K Meta+K"
              aria-expanded={paletteOpen}
              aria-controls="command-palette"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              aria-activedescendant={paletteOpen && hits.length > 0 ? `palette-hit-${hits[Math.min(Math.max(paletteIndex, 0), hits.length - 1)]!.key}` : undefined}
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">⌘K</span>
            {paletteOpen && (
              <div id="command-palette" className="command-palette floating-menu absolute z-30 mt-2 max-h-80 w-full overflow-auto p-2" role="listbox" aria-label="Search results">
                {hits.length === 0 && <p className="px-2 py-3 text-sm text-muted">No matches.</p>}
                {hits.map((hit, index) => {
                  const kind = hit.meta === "Chat" ? "chat" : hit.meta === "Agent" ? "agent" : hit.meta === "Project" ? "project" : hit.meta === "File" ? "file" : null;
                  const active = hits.length > 0 && index === Math.min(Math.max(paletteIndex, 0), hits.length - 1);
                  return (
                    <div key={hit.key} className="flex items-center gap-1">
                      <button
                        type="button"
                        id={`palette-hit-${hit.key}`}
                        role="option"
                        aria-selected={active}
                        className={`palette-option flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-panel px-2 text-left text-sm${active ? " palette-option-active" : ""}`}
                        onMouseEnter={() => setPaletteIndex(index)}
                        onClick={() => openPaletteHit(hit)}
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
            <img src="/brand/marks/grok.png" alt="" width={16} height={16} className="size-4 rounded" />
            {headerState}
          </span>
          <div className="hidden md:block">
            <ModelTierChip
              tier={modelTier}
              onChoose={chooseModelTier}
              lastResolved={lastResolvedTier}
              lastModel={lastModelUsed}
              logicRoute={logicRoute}
              logicRoutes={logicRoutes}
              onChooseLogic={(route) => {
                setLogicRoute(route);
                setProviderChoice(route);
              }}
            />
          </div>

          <button
            type="button"
            className="grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-full border border-line bg-white/5"
            aria-label="Speak"
            title="Speak"
            onClick={() => setSpeakStageOpen(true)}
          >
            <img src="/brand/marks/speak.png" alt="" width={22} height={22} className="size-5 rounded" />
          </button>
          <button
            type="button"
            className="grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-full border border-line bg-white/5"
            aria-label="Alerts"
            aria-expanded={bellOpen}
            aria-controls="alerts-panel"
            data-testid="alerts-toggle"
            onClick={() => {
              setBellOpen((open) => !open);
              setAccountOpen(false);
            }}
          >
            <Bell className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-11 min-h-11 items-center gap-2 rounded-full border border-line px-2"
            aria-label="Account menu"
            aria-expanded={accountOpen}
            aria-controls="account-panel"
            onClick={() => {
              setAccountOpen((open) => !open);
              setBellOpen(false);
            }}
          >
            <img src="/brand/marks/account.png" alt="" width={32} height={32} className="size-8 rounded-full object-cover" />
            <span className="hidden text-sm md:inline">Adrian</span>
          </button>
        </header>
        {bellOpen && (
          <div id="alerts-panel" className="border-b border-line bg-surface px-4 py-3 text-sm" data-testid="alerts-panel" role="region" aria-label="Alerts">
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
          <div id="account-panel" className="border-b border-line bg-surface px-4 py-3 text-sm" role="region" aria-label="Account">
            <p className="font-semibold">Adrian (Personal)</p>
            <UserButton />
            <SupabaseAccountControls />
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
        {failure && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2"
            role="alert"
            data-testid="failure-banner"
            data-failure-kind={failure.kind ?? "unknown"}
          >
            <p className="text-sm text-danger">{failure.message}</p>
            <div className="flex flex-wrap gap-2">
              {failure.action === "setup" ? (
                <button
                  type="button"
                  data-testid="failure-setup"
                  className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
                  onClick={() => {
                    clearFailure();
                    setView("connected");
                    setNavOpen(false);
                  }}
                >Setup</button>
              ) : failure.action !== "none" ? <button
                type="button"
                data-testid="failure-retry"
                className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50"
                disabled={!failure.retry}
                onClick={() => {
                  const retry = failure.retry;
                  clearFailure();
                  retry?.();
                }}
              >
                Retry
              </button> : null}
              <button
                type="button"
                data-testid="failure-view-log"
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
              <button
                type="button"
                data-testid="failure-dismiss"
                className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm"
                onClick={() => clearFailure()}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {saveError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2" role="status" data-testid="save-retry">
            <p className="text-sm text-muted">{saveError}</p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm"
              onClick={() => {
                void retrySave();
              }}
            >
              Retry save
            </button>
          </div>
        ) : null}
        {statusSignedIn !== true && (
          <div className="signed-out-entry sign-in-strip" data-testid="signed-out-entry" role="status">
            <span>Sign in to use voice and connected services.</span>
            <Link to="/login" className="signed-out-entry__link">Sign in</Link>
          </div>
        )}

        <div ref={pageScrollRef} className={`min-h-0 flex-1 ${view === "chat" || view === "dashboard" || view === "intelligence" ? "overflow-hidden" : "overflow-auto pb-24"}`}>
          {view === "intelligence" && (
            <EveWorkbench
              workspace={ws}
              personalityId={active?.personalityId ?? "assistant"}
              customPersonality={active?.customPersonality ?? ""}
              chatTitle={active?.title ?? ""}
              onCommand={(command) => {
                const result = applyWorkbenchCommand(wsRef.current, command);
                setWs(result.workspace);
                if (result.ok) {
                  setNotice(result.message);
                  setError(null);
                } else {
                  setError(result.message);
                }
              }}
              onToggleStop={() => { void toggleStop(); }}
              onPreviewVoice={(line) => { void speak(line); }}
              onOpenChat={() => { setView("command"); setNavOpen(false); }}
              onOpenDashboard={() => { setView("dashboard"); setNavOpen(false); }}
              onOpenAgents={() => { setView("agents"); setNavOpen(false); }}
              onOpenRuns={() => { setView("runs"); setNavOpen(false); }}
              onOpenConnections={() => { setView("connected"); setNavOpen(false); }}
            />
          )}
          {view === "dashboard" && (
            <div className="h-full min-h-0">
              <Suspense fallback={<p className="p-6 text-sm text-muted">Opening the dashboard…</p>}>
                <DashboardApp embedded />
              </Suspense>
            </div>
          )}
          {view === "command" && (
           <div className="gpt-home mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-4 p-4 md:p-6">
              <div className="masthead flex items-center gap-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h1 className="font-display text-3xl font-bold md:text-4xl">
                      {now ? greeting(now) : "Hello"}, <span className="text-accent">Adrian</span>
                    </h1>
                    <p className="text-sm text-muted">Ask, build, or connect. The rest lives in Settings.</p>
                  </div>
                </div>
              </div>
             <div className="gpt-starters">
               <button type="button" aria-pressed={homeAction === "image"} onClick={() => { setHomeAction("image"); setCommandMode("ask"); setDraft(""); }}>
                 <Image className="size-5" /> Create an image
               </button>
                <button type="button" aria-pressed={homeAction === "write"} onClick={() => { setHomeAction("write"); setCommandMode("build"); setDraft(""); }}>
                  <FileText className="size-5" /> Write or edit
                </button>
                <button type="button" aria-pressed={homeAction === "search"} onClick={() => { setHomeAction("search"); setCommandMode("research"); setDraft(""); }}>
                  <Search className="size-5" /> Search the web
                </button>
              </div>
              {homeAction !== "ask" ? <p className="gpt-starters text-sm text-muted">{homeAction === "image" ? "Image. Describe it, then send." : homeAction === "write" ? "Write. Say what to change, then send." : "Search. Type the question, then send."}</p> : null}

              <section className="floating-composer command-card composer-dock rounded-panel p-3 md:p-4" data-composer="floating">
                <details className="composer-advanced">
                  <summary>Controls</summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setAutonomy("ask")} title="Review and approve before action" className={`min-h-10 rounded-full px-3 text-sm font-semibold ${autonomy === "ask" ? "bg-accent text-accent-ink" : "border border-line text-muted"}`}>
                    Ask first
                  </button>
                  <button type="button" onClick={() => setAutonomy("automatic")} title="Deletes and replacements still ask you" className={`min-h-10 rounded-full px-3 text-sm font-semibold ${autonomy === "automatic" ? "bg-accent text-accent-ink" : "border border-line text-muted"}`}>
                    Automatic
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={memoryChoice === "on"}
                    title="Opt in before this command can read notes."
                    onClick={() => {
                      if (memoryChoice === "on") {
                        setMemoryChoice("off");
                        return;
                      }
                      setArmMemory("composer");
                    }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-3 text-sm"
                  >
                    <span>Memory {memoryChoice === "on" ? "on" : "off"}</span>
                    <span className={`relative h-5 w-9 rounded-full ${memoryChoice === "on" ? "bg-accent" : "bg-line"}`}>
                      <span className={`absolute top-0.5 size-4 rounded-full bg-fg ${memoryChoice === "on" ? "right-0.5" : "left-0.5"}`} />
                    </span>
                  </button>
                </div>
                </details>
                <form
                  className="mt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (homeAction === "image") {
                      void runImagine(draft.trim() || undefined, null);
                      return;
                    }
                    void sendCommand();
                  }}
                >
                  <div className="composer-modes mb-2">
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
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={homeAction === "image" ? "Describe the image" : homeAction === "write" ? "What should I write or edit?" : homeAction === "search" ? "Search the web" : "Ask Adrian"}
                    aria-label="Command"
                    rows={3}
                    className="input-glow w-full resize-none rounded-[1.1rem] border border-line/80 bg-bg/70 px-3 py-3 text-sm"
                  />
                  {error && !error.includes("Notion status") ? (
                    <p className="composer-error" role="alert">
                      {error}{" "}
                      {error.includes("Sign in") ? <Link to="/login">Sign in</Link> : null}
                    </p>
                  ) : null}
                  {staged && (
                    <p className="mt-2 text-xs text-muted">Staged: {staged.name}. It stays in this browser and is sent only if you press Send.</p>
                  )}
                  <div className="composer-toolbar mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line bg-white/5 px-3 text-sm" onClick={() => fileRef.current?.click()}>
                      <Paperclip className="size-4" /> Attach
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => imageInputRef.current?.click()}>
                      <Image className="size-4" /> Image
                    </button>
                    <details className="composer-more">
                      <summary>More</summary>
                      <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => setCameraOpen(true)}>
                      <Camera className="size-4" /> Camera
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" onClick={() => setCloudPickerOpen(true)}>
                      Drive
                    </button>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm"
                      disabled={busy || ws.halted}
                      onClick={() => {
                        const viaCmd = parseImagineCommand(draft);
                        const prompt = viaCmd !== null ? viaCmd : draft.trim();
                        void runImagine(prompt || undefined, null);
                      }}
                    >
                      Imagine
                    </button>
                    <AttachmentChips images={pendingImages} onRemove={(index) => setPendingImages((prev) => prev.filter((_, i) => i !== index))} onEditImagine={(image) => void runImagineEdit(image.dataUrl)} />
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
                      </div>
                      <RoutingModeControl
                        mode={routingMode}
                        panel={routingPanel}
                        onMode={chooseRoutingMode}
                        onToggle={toggleRoutingSeat}
                      />
                    </details>
                    <div className="legacy-composer-voice"><VoiceLevelMeter level={voiceLevel} listening={voiceListening} className="mr-1" /><BrowserDictationControl
                      state={dictation.phase}
                      level={dictationLevel}
                      elapsedSec={dictationElapsed}
                      disabled={dictationDisabled}
                      onMicClick={onDictationMic}
                      onStop={stopBrowserDictation}
                      onCancel={() => cancelBrowserDictation(true)}
                    />
                    <VoiceModeButton pressed={voiceOverlayOpen} onClick={() => void openVoiceOverlay()} />
                    <VoiceWaveform level={voiceLevel} active={voiceListening || speaking} className="ml-auto" />
                    <button type="button" title={voiceMicAriaLabel(voiceListening)} className={`grid size-11 place-items-center rounded-panel border border-line ${voiceListening ? "bg-accent text-accent-ink" : "text-muted"}`} onClick={() => void listen()} aria-label={voiceMicAriaLabel(voiceListening)} aria-keyshortcuts={VOICE_TOGGLE_SHORTCUT.ariaKeyshortcuts} aria-pressed={voiceListening}>
                      {voiceListening ? <Square className="size-4" /> : <Mic className="size-4" />}
                    </button></div>

                    <ComposerEffortControl mode={composerEffort} onChoose={chooseComposerEffort} />
                    <label className="inline-flex min-h-11 items-center gap-2 text-xs text-muted">
                      Style
                      <select aria-label="Conversation style" value={defaultPersonalityId} onChange={(event) => setDefaultPersonalityId(event.target.value as PersonalityId)} className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm text-fg">
                        {CONVERSATIONAL_PERSONALITIES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                      </select>
                    </label>
                    <button type="submit" disabled={busy || ws.halted || (!draft.trim() && pendingImages.length === 0 && !staged)} className="composer-send inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
                      <Send className="size-4" /> {busy ? "Sending" : "Send"}
                    </button>
                    {draft.trim() || pendingImages.length > 0 || staged ? (
                      <button type="submit" className="gpt-voice grid size-11 place-items-center rounded-full bg-[#2f6bff] text-white" aria-label="Send">
                        <Send className="size-4" />
                      </button>
                    ) : (
                      <button type="button" className="gpt-voice grid size-11 place-items-center rounded-full bg-[#2f6bff] text-white" aria-label="Speak" onPointerDown={(event) => { event.preventDefault(); setSpeakStageOpen(true); }} onClick={() => setSpeakStageOpen(true)}>
                        <Volume2 className="size-4" />
                      </button>
                    )}
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
                    <li className="text-muted">Imagine — Grok Imagine (composer /imagine). Video — paid API, not called. HP — not paired.</li>
                    <li>
                      <p className="font-semibold">MCP servers</p>
                      <ul className="mt-2 space-y-2">
                        {mcpRegistryListState.status === "ready" && mcpRegistry.map((server) => (
                          <li key={server.id} className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line px-3 py-2">
                            <span>{server.label} · {server.kind} · {server.enabled ? "On" : "Off"}</span>
                            <button
                              type="button"
                              className="min-h-11 rounded-panel border border-line px-3"
                              onClick={() => {
                                void mcpRegistryToggle({ data: { id: server.id, enabled: !server.enabled } }).then((result) => setMcpRegistry(result.servers));
                              }}
                            >
                              {server.enabled ? "Turn off" : "Turn on"}
                            </button>
                          </li>
                        ))}
                        <McpListStatusRows
                          state={mcpRegistryListState}
                          onRetry={() => mcpRegistryRetryRef.current?.()}
                          onViewLog={() => {
                            setView("activity");
                            setActivityQuery("");
                            setNavOpen(false);
                          }}
                        />
                      </ul>
                      <button type="button" className="mt-2 min-h-11 text-accent" onClick={() => setView("tools")}>
                        Open Tools panel
                      </button>
                      {toolResultStatus !== "idle" ? <p className="mt-2 text-xs text-muted">Last tool call: {toolResultStatus}</p> : null}
                    </li>
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

              <div className="grid gap-3 xl:grid-cols-3">
                <Panel title="Active Projects" action="View all" onAction={() => setView("projects")}>
                  {!ready && (
                    <div className="workspace-loading" role="status" data-testid="projects-loading">
                      <p>Loading projects saved in this browser…</p>
                      <div className="skeleton h-3" style={{ width: "72%" }} />
                      <div className="skeleton h-3" style={{ width: "46%" }} />
                    </div>
                  )}
                  {ready && ws.projects.length === 0 && (
                    <div className="empty-state mt-3 text-sm text-muted" data-testid="projects-empty">
                      <p className="font-semibold text-fg">No projects yet</p>
                      <p>Create one and it stays on this device until you export it.</p>
                    </div>
                  )}
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
                  <StatusRow icon={Bot} name="Voice" detail="Dictate uses browser speech and inserts text. It is not a realtime session. Voice mode opens the realtime session." pill={voiceOverlayOpen ? "Voice mode" : "Browser speech"} tone="muted" />
                  <StatusRow icon={Bot} name="REA" detail="CLI from GitHub runs. Native engines are not installed." pill="Partial" tone="muted" />
                  <StatusRow icon={Square} name="HP" detail="Local device integration" pill="Not paired" tone="danger" />
                  <p className="mt-3 text-xs text-muted">Grok: {grok}. Checked {stamp(checkedAt) || checkedAt}. {system}</p>
                </Panel>
                <Panel title="Recent Activity" action="View all" onAction={() => setView("activity")}>
                  {!ready && (
                    <div className="workspace-loading" role="status" data-testid="activity-loading">
                      <p>Loading activity saved in this browser…</p>
                      <div className="skeleton h-3" style={{ width: "80%" }} />
                      <div className="skeleton h-3" style={{ width: "38%" }} />
                    </div>
                  )}
                  {ready && ws.audit.length === 0 && (
                    <div className="empty-state mt-3 text-sm text-muted" data-testid="activity-empty">
                      <p className="font-semibold text-fg">No activity yet</p>
                      <p>Actions you take show up here. Nothing is invented.</p>
                    </div>
                  )}
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
              personalityId={active?.personalityId ?? "assistant"}
              onPersonalityChange={(personalityId) => { if (active) setWs((prev) => updateChatPersonality(prev, active.id, personalityId)); }}
              customPersonality={active?.customPersonality ?? ""}
              onCustomPersonalityChange={(value) => { if (active) setWs((prev) => updateChatCustomPersonality(prev, active.id, value)); }}
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
              onSpeak={(text, messageId) => void speak(text, messageId ?? "")}
              onListen={() => void listen()}
              onListenStop={() => void listen({ mode: "stop" })}
              onLiveUserTranscript={(text) => appendLiveVoiceUser(text)}
              onLiveAssistantTranscript={(text) => appendLiveVoiceAssistant(text)}
              onLiveVoiceError={(message) => setError(message)}
              onLiveVoiceNotice={(message) => setNotice(message)}
              speaking={speaking}
              voiceListening={voiceListening}
              voiceMuted={voiceMuted}
              voiceLevel={voiceLevel}
              onToggleMute={toggleVoiceMute}
              dictationState={dictation.phase}
              dictationLevel={dictationLevel}
              dictationElapsed={dictationElapsed}
              dictationDisabled={dictationDisabled}
              onDictationMic={onDictationMic}
              onDictationStop={stopBrowserDictation}
              onDictationCancel={() => cancelBrowserDictation(true)}
              onOpenVoiceMode={() => void openVoiceOverlay()}
              voiceOverlayOpen={voiceOverlayOpen}
              memoryChoice={active?.memory ?? memoryChoice}
              mode={active?.autonomy ?? autonomy}
              onMemoryChange={(next) => {
                if (!active) {
                  setMemoryChoice(next);
                  return;
                }
                setWs((prev) =>
                  pushAudit(
                    { ...prev, chats: prev.chats.map((chat) => (chat.id === active.id ? { ...chat, memory: next } : chat)) },
                    next === "on" ? "memory_on" : "memory_off",
                    active.id,
                    next === "on" ? "owner enabled retrieval" : "retrieval stopped",
                  ),
                );
              }}
              onComposerMode={(next) => {
                setAutonomy(next);
                if (!active) return;
                setWs((prev) => ({
                  ...prev,
                  chats: prev.chats.map((chat) => (chat.id === active.id ? { ...chat, autonomy: next } : chat)),
                }));
              }}
              composerEffort={composerEffort}
              onComposerEffort={chooseComposerEffort}
              routingMode={routingMode}
              onRoutingMode={chooseRoutingMode}
              routingPanel={routingPanel}
              onToggleRoute={toggleRoutingSeat}
              ratings={ratings}
              onRate={rateReply}
              stagedName={staged?.name ?? null}
              pendingImages={pendingImages}
              onRemoveImage={(index) => setPendingImages((prev) => prev.filter((_, i) => i !== index))}
              onAttach={() => fileRef.current?.click()}
              onAttachImage={() => imageInputRef.current?.click()}
              onOpenCamera={() => setCameraOpen(true)}
              onOpenCloud={() => setCloudPickerOpen(true)}
              onImagine={() => {
                const viaCmd = parseImagineCommand(draft);
                const prompt = viaCmd !== null ? viaCmd : draft.trim();
                void runImagine(prompt || undefined, active);
              }}
              onEditImagine={(src) => void runImagineEdit(src)}
              onSaveImage={(src, alt) => saveImageToComposer(src, alt)}
              onDownloadImage={(src, alt) => downloadImageDataUrl(src, alt)}
              onAddImageFile={(file) => void addImageAttachment(file)}
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
              providerChoices={[...providerChoicesWithKeys(grokConfigured, lastModelUsed, liveProviders), ...customAiChoices]}
              providerChoice={providerChoice}
              onProvider={(id) => {
                if (isLogicRouteId(id)) {
                  const view = logicRoutes.find((item) => item.id === id);
                  if (!view?.ready) return;
                  setLogicRoute(id);
                  setProviderChoice(id);
                  return;
                }
                setLogicRoute(null);
                setProviderChoice(id);
              }}
              modelTier={modelTier}
              onModelTier={chooseModelTier}
              logicRoute={logicRoute}
              logicRoutes={logicRoutes}
              onChooseLogic={(route) => {
                setLogicRoute(route);
                setProviderChoice(route);
              }}
              toolTimeline={toolTimeline}
              timelineNowMs={timelineTickMs || Date.now()}
              agentActivity={agentActivityFromTimeline(toolTimeline)}
              recentTasks={recentTasksFromAudit(ws.audit)}
              connectedServices={connectedServicesRail({
                grokConfigured,
                notionState: notion?.state ?? null,
                mcpConnected: mcpServers.some((server) => server.state === "connected"),
              })}
              systemStatus={systemStatusRail({
                grokConfigured,
                databaseConfigured,
                searchConfigured: (CAPABILITIES.find((item) => item.id === "research")?.status === "configured"
                  || CAPABILITIES.find((item) => item.id === "research")?.status === "ready"
                  || CAPABILITIES.find((item) => item.id === "research")?.status === "live_verified") ?? false,
                signedIn: statusSignedIn,
              })}
              onViewAudit={(auditId) => {
                setView("activity");
                setFocusAuditId(auditId);
                setActivityQuery("");
                setNavOpen(false);
              }}
            />
          )}

          {view === "projects" && (
            <section className="page-shell">
              <div className="page-hero mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/projects.png" alt="" className="size-10 rounded-xl" />
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
              <div id="owner-projects">
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
                      <img src={item.mark} alt="" className="size-11 rounded-2xl" />
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
            <section className="page-shell p-4 md:p-6">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/memory.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Memory</h2>
                    <p className="text-sm text-muted">Notes you chose to keep. They stay in this browser, not a remote database.</p>
                  </div>
                </div>
              </div>
              <div className={`glow-card mt-4 grid gap-4 rounded-panel border p-4 md:grid-cols-2 ${memoryChoice === "on" ? "border-ok/40" : "border-danger/40"}`}>
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/memory.png" alt="" className="size-12 rounded-2xl" />
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
                <textarea value={memoryText} onChange={(event) => setMemoryText(event.target.value)} placeholder="Write a note you want kept" rows={2} className="rounded-panel border border-line bg-surface px-3 py-2 text-sm" />
                <div className="flex flex-wrap gap-2">
                  <select aria-label="Memory scope" value={memoryScope} onChange={(event) => setMemoryScope(event.target.value as MemoryScope)} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
                    <option value="global">Global</option>
                    <option value="project">Project</option>
                  </select>
                  {memoryScope === "project" && (
                    <select aria-label="Memory project" value={memoryProject} onChange={(event) => setMemoryProject(event.target.value)} className="min-h-11 rounded-panel border border-line bg-surface px-3 text-sm">
                      <option value="">Choose project</option>
                      {ws.projects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  )}
                  <input aria-label="Search notes" value={memoryQuery} onChange={(event) => setMemoryQuery(event.target.value)} placeholder="Search notes" className="min-h-11 min-w-40 flex-1 rounded-panel border border-line bg-surface px-3 text-sm" />
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
            <div className="page-hero mx-4 mt-4 flex items-center gap-3 md:mx-6">
              <img src="/brand/marks/bots.png" alt="" className="size-8 rounded-lg" />
              <div>
                <h2 className="font-display text-3xl font-bold">Bots</h2>
                <p className="text-sm text-muted">Templates stay on this device. A hosted bot runs only when its service answers.</p>
              </div>
            </div>
            <ReaPanel
              title="Agents"
              lead="REA checks a file. Workspace lookup lists projects and chats, then searches notes. It does not call a model, browse the web, or mark itself running."
              report={reaReport}
              busy={reaBusy}
              onCheck={() => void checkRea()}
              onInspect={staged ? () => void inspectWithRea(staged, "agents") : null}
            />
            <details className="mx-4 mb-6 rounded-panel border border-line bg-surface p-4 md:mx-6">
              <summary className="min-h-11 cursor-pointer font-semibold">Look up on this device</summary>
            <form
              className="mt-3"
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
              className="mt-4 border-t border-line pt-4"
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
              {agentImages.length > 0 && (
                <div className="mt-3 space-y-2">
                  {agentImages.map((image, index) => (
                    <InlineImage key={`${image.name ?? "imagine"}-${index}`} src={image.dataUrl} alt={image.name ?? `Generated ${index + 1}`} onEditImagine={(src) => void runImagineEdit(src)} onSave={(src, alt) => saveImageToComposer(src, alt)} onDownload={(src, alt) => downloadImageDataUrl(src, alt)} />
                  ))}
                </div>
              )}
              {agentLog.length > 0 && (
                <ol className="mt-3 space-y-1 text-sm">
                  {agentLog.map((entry) => (
                    <li key={`${entry.step}-${entry.tool}`}>{entry.step}. {entry.tool} — {entry.ok ? "ok" : "failed"} — {entry.detail}</li>
                  ))}
                </ol>
              )}
            </form>
            </details>
            <FleetPanel mode="agents" ws={ws} setWs={setWs} />
            </>
          )}
          {view === "runs" && <FleetPanel mode="runs" ws={ws} setWs={setWs} />}
          {view === "connected" && (
            <section className="page-shell">
              <div className="page-hero mb-4 flex items-center gap-3"><img src="/brand/marks/plugins.png" alt="" className="size-8 rounded-lg" /><div><h2 className="font-display text-3xl font-bold">Connected</h2><p className="text-sm text-muted">Setup explains what is missing. A service is connected only after the server says so.</p></div></div>
              {statusSignedIn === false ? <div className="sign-in-summary" role="status">Sign in to check your connections. <Link to="/login">Sign in</Link></div> : null}
              <ServiceBoard
                grokConfigured={grokConfigured === true}
                notion={notion}
                mcp={mcpBoard}
                onSetup={(message) => {
                  const retry = () => setNotice(message);
                  if (emitFailure("serviceBoard", mountFailure({ message, action: "service_setup", target: "serviceBoard" }, retry))) return;
                  setNotice(message);
                }}
                onOpenConnect={(name) => {
                  if (name === "Slack") {
                    setNotice("Slack stays off. No Slack login was started.");
                    return;
                  }
                  const target = name === "MCP" ? "owner-mcp-connect" : name === "Notion" ? "owner-notion-search" : name === "OpenAI" || name === "Claude" || name === "Gemini" || name === "OpenRouter" ? "owner-api-connect" : null;
                  if (!target) return;
                  window.dispatchEvent(new CustomEvent("adrian-open-connect", { detail: { name } }));
                  document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setNotice("The paste form is open below. A card is connected only after the server says so.");
                }}
                onDisconnect={() => {
                  void notionDisconnect().then((status) => {
                    setNotion(status);
                    setNotice(status.detail);
                  });
                }}
              />
              <form
                id="owner-notion-search"
                className="rounded-panel border border-line bg-surface p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const query = notionQuery.trim();
                  if (!query || ws.halted) return;
                  void notionCommand({ data: { text: `Search my Notion for ${query}`, confirmed: false, pageId: null } }).then((result) => {
                    setNotionPages(result.pages);
                    setNotionNote(result.error || (result.pages.length ? "" : "Notion returned no pages."));
                    if (!result.ok) {
                      const message = result.error || "Notion search did not complete.";
                      reportFailure(message, "notion_search_failed", "notion:search", () => {
                        void notionCommand({ data: { text: `Search my Notion for ${query}`, confirmed: false, pageId: null } }).then((retryResult) => {
                          setNotionPages(retryResult.pages);
                          setNotionNote(retryResult.error || (retryResult.pages.length ? "" : "Notion returned no pages."));
                        }).catch(() => undefined);
                      });
                    }
                  }).catch(() => {
                    const message = "Notion search could not be completed. Its connection state is unchanged.";
                    reportFailure(message, "notion_search_failed", "notion:search", () => {
                      void notionCommand({ data: { text: `Search my Notion for ${query}`, confirmed: false, pageId: null } }).then((retryResult) => {
                        setNotionPages(retryResult.pages);
                        setNotionNote(retryResult.error || (retryResult.pages.length ? "" : "Notion returned no pages."));
                      }).catch(() => undefined);
                    });
                    setNotionNote(message);
                  });
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
                id="owner-mcp-connect"
                className="rounded-panel border border-line bg-surface p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveConnectedMcp();
                }}
              >
                <h3 className="font-semibold">MCP server</h3>
                <p className="mt-1 text-sm text-muted">The token stays on the server. Connected means the server answered initialize and tools/list.</p>
                <input value={mcpLabel} onChange={(event) => setMcpLabel(event.target.value)} placeholder="Label" className="mt-3 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <input value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://mcp.example/tools" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <input value={mcpToken} onChange={(event) => setMcpToken(event.target.value)} type="password" placeholder="Token, optional" autoComplete="off" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
                <button type="submit" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={ws.halted || mcpMutationBusy || !mcpUrl.trim()}>Test and save</button>
                <ul className="mt-3 space-y-2">
                  {mcpSavedListState.status === "ready" && mcpServers.map((server) => (
                    <li key={server.id} className="rounded-panel border border-line px-3 py-2 text-sm">
                      <span className="font-semibold">{server.label}</span>
                      <span className="ml-2 text-muted">{server.host} · {server.state}</span>
                      <p className="text-muted">{server.error || server.tools.map((tool) => tool.name).join(", ") || "No tools returned."}</p>
                      <button
                        type="button"
                        className="mt-2 min-h-11 rounded-panel border border-line px-3"
                        disabled={ws.halted || mcpMutationBusy}
                        onClick={() => { void removeConnectedMcp(server.id); }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                  <McpListStatusRows
                    state={mcpSavedListState}
                    onRetry={() => mcpSavedRetryRef.current?.()}
                    onViewLog={() => {
                      setView("activity");
                      setActivityQuery("");
                      setNavOpen(false);
                    }}
                  />
                </ul>
              </form>
              {notice && <p className="voice-copy rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{presentVoiceCopy(notice)}</p>}
              <AiProviderConnections onChange={setCustomAiProviders} />
              <FleetPanel
                mode="connected"
                ws={ws}
                setWs={setWs}
                logicRoutes={logicRoutes}
                providerChoice={logicRoute ?? providerChoice}
                onSelectProvider={(id) => {
                  if (isLogicRouteId(id)) {
                    const view = logicRoutes.find((item) => item.id === id);
                    if (!view?.ready) return;
                    setLogicRoute(id);
                    setProviderChoice(id);
                    return;
                  }
                  if (id === "grok") {
                    setLogicRoute(null);
                    setProviderChoice("grok");
                  }
                }}
              />
            </section>
          )}
          {view === "scheduled" && <FleetPanel mode="scheduled" ws={ws} setWs={setWs} />}
          {view === "tools" && <FleetPanel mode="tools" ws={ws} setWs={setWs} onFailure={(message, retry, surface) => reportFailure(message, surface === "mcp" ? "mcp_tool_failed" : "open_page_failed", surface === "mcp" ? "mcp:tools" : "browser", retry)} />}
          {view === "build" && (
            <section className="page-shell space-y-4">
              <BuildPanel />
              <BuildWorkspace />
            </section>
          )}
          {view === "research" && (
            <section className="page-shell">
              <div className="page-hero card-texture">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/research.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Research</h2>
                    <p className="text-sm text-muted">A search runs only when a search key is set. Otherwise this refuses and creates no citations.</p>
                  </div>
                </div>
              </div>
              <div className="solid-form mt-4">
                <label className="text-sm" htmlFor="research-question">Question</label>
                <textarea id="research-question" value={researchText} onChange={(event) => setResearchText(event.target.value)} placeholder="What do you want to research?" rows={3} className="input-glow mt-2 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
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
                <ResearchPanel onUse={setResearchText} />
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
          <section className={view === "skills" ? "page-shell space-y-4" : "hidden"}>
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/skills.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Skills</h2>
                    <p className="text-sm text-muted">Built-in skills read this device. Not installed means the outside service is not connected.</p>
                  </div>
                </div>
              </div>
              <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="Search skills" className="min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
              <div id="owner-skills">
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).map((skill) => {
                  const on = skill.kind === "built-in" && enabledSkills[skill.id] !== false;
                  return (
                    <article key={skill.id} className="skill-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <img src={`/brand/marks/${SKILL_MARK[skill.id] ?? "skills"}.png`} alt="" className="size-8 shrink-0 rounded-lg" />
                          <h3 className="font-semibold">{skill.name}</h3>
                        </div>
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
                                setSkillStorageError("");
                              } catch {
                                setSkillStorageError("Skill setting changed in this tab but could not be saved to browser storage.");
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
              {skillStorageError && <p className="rounded-panel border border-danger/40 p-3 text-sm text-danger" role="alert">{skillStorageError}</p>}
              {notice && <p className="voice-copy rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{presentVoiceCopy(notice)}</p>}
              <details className="owner-fold">
                <summary>Draft library</summary>
                <LocalSkillsTools skills={SKILLS} enabledSkills={Object.fromEntries(SKILLS.map((skill) => [skill.id, skill.kind === "built-in" && enabledSkills[skill.id] !== false]))} />
              </details>
          </section>
          {view === "files" && (
            <section className="page-shell">
              <div className="page-hero mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/library.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Library</h2>
                    <p className="text-sm text-muted">Text, markdown, CSV, and JSON are read as text. PDF text can be extracted when attached. Images attached on Command are decoded for Grok vision and Imagine — they are not OCR’d into Library text copies.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => fileRef.current?.click()}>Upload text</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" onClick={() => setCloudPickerOpen(true)}>Browse Drive</button>
                </div>
              </div>
              <div id="owner-library">
                <aside className="library-list text-sm">
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
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/integrations.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Integrations</h2>
                    <p className="text-xs text-muted">Last check {stamp(checkedAt) || checkedAt}. Green means that behavior was verified here. Configured means a key or setting exists and a live call was not verified.</p>
                  </div>
                </div>
              </div>
              <div id="owner-integrations" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {CAPABILITIES.map((item) => {
                  const live = isVerifiedCapability(item.status);
                  const page = CAPABILITY_PAGE[item.id];
                  return (
                    <article key={item.id} className="integration-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <img src={`/brand/marks/${CAPABILITY_MARK[item.id] ?? "integrations"}.png`} alt="" className="size-8 shrink-0 rounded-lg" />
                          <h3 className="text-sm font-semibold">{item.name}</h3>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${live ? "border-ok/40 text-ok" : item.status === "blocked" || item.status === "paid_required" ? "border-danger/40 text-danger" : "border-line text-muted"}`}>
                          {statusWord(item.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-muted">{item.why}</p>
                      {page && (
                        <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => openCapability(item.id, setView, setSettingsPane)}>
                          {CAPABILITY_CONNECT[item.id] ? "Set up" : "Open"}
                        </button>
                      )}
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
                  <img src="/brand/marks/activity.png" alt="" className="size-8 rounded-lg" />
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
            <section className="page-shell mx-auto max-w-3xl space-y-4">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/help.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Help</h2>
                    <p className="text-sm text-muted">Pick a row. It opens that part of the app. Nothing here pretends a service is connected.</p>
                  </div>
                </div>
              </div>
              <input
                value={helpQuery}
                onChange={(event) => setHelpQuery(event.target.value)}
                placeholder="Search help"
                aria-label="Search help"
                className="input-glow min-h-11 w-full rounded-panel border border-line bg-surface/80 px-3 text-sm"
              />
              <div id="owner-help">
                {[
                  { id: "chat", label: "Send a chat", detail: "Type in the field and press Enter, or press the blue button. An empty field opens Speak.", mark: "/brand/marks/chat.png", open: () => setView("command") },
                  { id: "speak", label: "Speak", detail: "Opens the call screen with camera, screen share, mute, and end.", mark: "/brand/marks/speak.png", open: () => setSpeakStageOpen(true) },
                  { id: "settings", label: "Settings", detail: "Theme, voice, connections, and the pages that stay off the short sidebar.", mark: "/brand/marks/settings.png", open: () => setView("settings") },
                  { id: "plugins", label: "Plugins", detail: "Catalog and connection marks. Opening a row does not connect the service.", mark: "/brand/marks/plugins.png", open: () => setView("connected") },
                  { id: "library", label: "Library", detail: "Text copies in this browser. Upload text or open a file you already attached.", mark: "/brand/marks/library.png", open: () => setView("files") },
                  { id: "projects", label: "Projects", detail: "Records on this device. Open chats or notes from a project card.", mark: "/brand/marks/projects.png", open: () => setView("projects") },
                  { id: "scheduled", label: "Scheduled", detail: "Jobs that wait for a time. Nothing runs until you start it.", mark: "/brand/marks/scheduled.png", open: () => setView("scheduled") },
                  { id: "build", label: "Build", detail: "Editor and next-step controls. No repository is edited until a computer is paired.", mark: "/brand/marks/build.png", open: () => setView("build") },
                  { id: "explore", label: "Explore", detail: "Filter local templates, save one, then open it in Chat.", mark: "/brand/marks/explore.png", open: () => window.location.assign("/explore") },
                  { id: "dashboard", label: "Dashboard", detail: "Opens the workspace map inside this app.", mark: "/brand/marks/general.png", open: () => setView("dashboard") },
                ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(helpQuery.trim().toLowerCase())).map((item) => (
                  <button key={item.id} type="button" className="flex min-h-14 w-full items-center gap-3 px-3 text-left text-sm hover:bg-white/5" onClick={() => { item.open(); setNavOpen(false); }}>
                    <img src={item.mark} alt="" width={28} height={28} className="size-7 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.label}</span>
                      <span className="block text-xs text-muted">{item.detail}</span>
                    </span>
                    <span className="text-muted" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {view === "settings" && (
            <section className="page-shell mx-auto max-w-3xl space-y-4">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/marks/settings.png" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Settings</h2>
                    <p className="text-sm text-muted">Preferences stay in this browser. Server keys are not edited here.</p>
                    <p className="text-sm text-muted">Preferences stay in this browser. Open Safe keys to copy a saved key.</p>
                  </div>
                </div>
              </div>
              <nav className="settings-index" aria-label="Settings sections" hidden={settingsPane !== null}>
                {[
                  { group: "Account", items: [
                    ["general", "General", "Theme and appearance", () => setSettingsPane("general")],
                    ["personalization", "Personalization", "How replies sound", () => { setView("chat"); setNavOpen(false); }],
                    ["memory", "Memory", "Notes you chose to keep", () => { setView("memory"); setNavOpen(false); }],
                    ["voice", "Voice", "Speak voice and pace", () => setSettingsPane("voice")],
                    ["keys", "Safe keys", "Open a saved key and copy it", () => setSettingsPane("keys")],
                    ["security", "Security and login", "Sign in to connect services", () => { window.location.assign("/login"); }],
                  ]},
                  { group: "Connections", items: [
                    ["plugins", "Plugins", "Marks and setup for each service", () => { setView("connected"); setNavOpen(false); }],
                    ["connections", "Connections", "API keys and saved providers", () => setSettingsPane("connections")],
                    ["integrations", "Integrations", "What each provider can do", () => { setView("integrations"); setNavOpen(false); }],
                  ]},
                  { group: "Work", items: [
                    ["scheduled", "Scheduled", "Jobs that wait for a time", () => { setView("scheduled"); setNavOpen(false); }],
                    ["bots", "Bots", "Agents and templates", () => { setView("agents"); setNavOpen(false); }],
                    ["eve", "EVE", "Operator workbench", () => { setView("intelligence"); setNavOpen(false); }],
                    ["runs", "Runs", "What an agent already did", () => { setView("runs"); setNavOpen(false); }],
                    ["tools", "Tools", "What this app can call", () => { setView("tools"); setNavOpen(false); }],
                    ["skills", "Skills", "Installed abilities", () => { setView("skills"); setNavOpen(false); }],
                    ["build", "Build", "Editor and next step", () => { setView("build"); setNavOpen(false); }],
                    ["research", "Research", "Search when a provider is set", () => { setView("research"); setNavOpen(false); }],
                    ["library", "Library", "Text copies in this browser", () => { setView("files"); setNavOpen(false); }],
                    ["projects", "Projects", "Records on this device", () => { setView("projects"); setNavOpen(false); }],
                  ]},
                  { group: "System", items: [
                    ["activity", "Activity", "What this device recorded", () => { setView("activity"); setNavOpen(false); }],
                    ["pages", "Pages", "Every section in one list", () => setSettingsPane("pages")],
                    ["data", "Data", "What stays in this browser", () => setSettingsPane("data")],
                    ["safety", "Safety", "Stops and confirmations", () => setSettingsPane("safety")],
                    ["help", "Help", "How the controls behave", () => { setView("help"); setNavOpen(false); }],
                  ]},
                ].map((section) => (
                  <div key={section.group} className="settings-group">
                    <p>{section.group}</p>
                    {section.items.map(([id, label, detail, open]) => (
                      <button key={id} type="button" onClick={open}>
                        <img src={`/brand/marks/${id}.png`} alt="" width={28} height={28} />
                        <span>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
              {settingsPane && (
                <button type="button" className="text-sm text-muted" onClick={() => setSettingsPane(null)}>Back</button>
              )}
              <section id="settings-pages" hidden={settingsPane !== "pages"} className="settings-card rounded-panel border border-line p-4">
                <p className="font-semibold">Pages</p>
                <p className="mt-1 text-sm text-muted">These stay out of the sidebar so Chat stays short. Search still opens them.</p>
                <div className="mt-4 space-y-4">
                  {SETTINGS_PAGES.map((group) => (
                    <div key={group.group}>
                      <p className="text-sm font-semibold text-muted">{group.group}</p>
                      <div className="mt-2 divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
                        {group.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-white/5"
                            onClick={() => {
                              setView(item.id);
                              setNavOpen(false);
                            }}
                          >
                            <span>
                              <span className="block font-medium">{item.label}</span>
                              <span className="block text-xs text-muted">{item.detail}</span>
                            </span>
                            <span className="text-muted" aria-hidden="true">›</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <p className="text-sm font-semibold text-muted">Routes</p>
                    <div className="mt-2 divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
                      <Link to="/explore" className="flex min-h-12 items-center justify-between px-3 text-sm hover:bg-white/5">
                        <span>
                          <span className="block font-medium">Explore</span>
                          <span className="block text-xs text-muted">Public directory</span>
                        </span>
                        <span className="text-muted" aria-hidden="true">›</span>
                      </Link>
                      <Link to="/dashboard" className="flex min-h-12 items-center justify-between px-3 text-sm hover:bg-white/5">
                        <span>
                          <span className="block font-medium">Dashboard</span>
                          <span className="block text-xs text-muted">Public command center</span>
                        </span>
                        <span className="text-muted" aria-hidden="true">›</span>
                      </Link>
                    </div>
                  </div>
                </div>
              </section>
              <div id="settings-general" hidden={settingsPane !== "general"} className="settings-card card-texture rounded-panel p-4 text-sm">
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">Appearance</p>
                    <p className="text-muted">Dark, light, or follow this device. Saved in this browser only.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["dark", "light", "system"] as const).map((choice) => {
                      const label = choice === "dark" ? "Dark" : choice === "light" ? "Light" : "System";
                      return (
                      <button key={choice} type="button" className={`min-h-11 rounded-panel border px-3 ${theme === choice ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => setTheme(choice)}>
                        {label}
                      </button>
                    );})}
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">Provider failover</p>
                    <p className="text-muted">{failoverPolicy === "none" ? "Off. A failed provider is not replaced." : "On. A failed provider can switch to Grok, and the switch is recorded."}</p>
                  </div>
                  <button type="button" role="switch" aria-checked={failoverPolicy === "grok"} className={`min-h-11 rounded-panel border px-3 ${failoverPolicy === "grok" ? "border-accent bg-accent text-accent-ink" : "border-line"}`} onClick={() => setFailoverPolicy((current) => (current === "grok" ? "none" : "grok"))}>
                    {failoverPolicy === "grok" ? "On" : "Off"}
                  </button>
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
              <div id="settings-connections" hidden={settingsPane !== "connections"} className="space-y-4">
                <AiProviderConnections onChange={setCustomAiProviders} />
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setSettingsPane("keys")}>Open Safe keys</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setView("connected")}>Open connections</button>
              </div>
              <div id="settings-keys" hidden={settingsPane !== "keys"} className="space-y-4">
                <SafeKeysPanel
                  onCopy={async (id) => {
                    try {
                      const result = await copyOwnerKeyFn({ data: { id } });
                      return result.ok ? result.value : null;
                    } catch {
                      return null;
                    }
                  }}
                />
              </div>
              <div id="settings-voice" hidden={settingsPane !== "voice"}>
                <VoiceSettingsBlock />
                <SpeakPanel />
              </div>
              <div id="settings-data" hidden={settingsPane !== "data"} className="space-y-4">
              <div className="settings-card rounded-panel p-4 text-sm">
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">On this device</p>
                    <p className="text-muted">{formatBytes(storedBytes)}. {syncNote}</p>
                  </div>
                </div>
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">What stays here</p>
                    <p className="text-muted">Chats, notes, and files on this browser. A phone keeps its own copy.</p>
                  </div>
                </div>
              </div>
              {serverHeld && (
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    const run = () => {
                      void retrySave()
                        .then((result) => {
                          const message = saveFailureMessage(result);
                          if (message) {
                            reportFailure(message, "database_write_failed", "server-copy", run);
                            return;
                          }
                          clearFailure();
                        })
                        .catch(() => {
                          const message = saveFailureMessage({ ok: false });
                          if (message) reportFailure(message, "database_write_failed", "server-copy", run);
                        });
                    };
                    run();
                  }}
                >
                  Save this browser copy over the server copy
                </button>
              )}
              </div>
              <div id="settings-safety" hidden={settingsPane !== "safety"} className="space-y-4">
              <div className="settings-card rounded-panel p-4 text-sm">
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm font-semibold"
                onClick={() => void toggleStop()}
              >
                <Square className="size-4" /> {ws.halted ? "Clear emergency stop" : "Emergency stop"}
              </button>
              <p className="mt-2 text-muted">Stops new sends on this page and on the server. It is not the same as stopping one reply.</p>
              </div>
              <div className="settings-card rounded-panel p-4">
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
              <div className="settings-card rounded-panel p-4 text-sm">
                <p className="font-semibold">Requirement record</p>
                <p className="mt-1 text-muted">Verified {counts.verified} · In the app {counts.implemented} · Blocked {counts.blocked} · Planned {counts.planned} · Deferred {counts.deferred}</p>
                <ul className="mt-2 space-y-1 text-muted">
                  {REQUIREMENTS.filter((row) => row.status === "blocked" || row.status === "deferred").map((row) => (
                    <li key={row.id}>{row.text} — {row.note}</li>
                  ))}
                </ul>
              </div>
              </div>
            </section>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.json,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.js,.ts,.mjs,text/plain,application/pdf,image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onPicked(file);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void addImageAttachment(file);
        }}
      />
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl, name) => {
          setPendingImages((prev) => prev.length >= 4 ? prev : [...prev, { dataUrl, name, mime: "image/jpeg" }]);
          setNotice(`Camera snapshot “${name}” attached to the composer. Press Send to include it.`);
        }}
      />
      <CloudPicker
        open={cloudPickerOpen}
        onClose={() => setCloudPickerOpen(false)}
        onAttach={applyCloudAttach}
        onNotice={(message) => setNotice(message)}
      />

      {voiceSignInNotice && (
        <Overlay>
          <h3 className="font-display text-xl font-bold">Sign in to use Speak</h3>
          <p className="mt-2 text-sm text-muted">Voice starts only after you sign in and press Speak. Your microphone has not been requested.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => setVoiceSignInNotice(false)}>Cancel</button>
            <Link to="/login" className="min-h-11 flex-1 rounded-panel bg-accent text-center leading-[2.75rem] font-semibold text-accent-ink">Sign in</Link>
          </div>
        </Overlay>
      )}
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
      <style>{`@media (max-width: 767.98px) {
        nav.fixed.inset-x-0.bottom-0[aria-label="Primary"] { z-index: 30 !important; }
        .shell .live-voice-compact-entry { z-index: 60 !important; bottom: calc(4.75rem + env(safe-area-inset-bottom, 0px)) !important; }
      }`}</style>
      <nav inert={navOpen} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line/70 bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label="Primary">
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
        {NAV.filter((item) => item.id === "dashboard" || item.id === "projects").map((item) => {
          const Icon = item.icon;
          const on = view === item.id;
          return (
            <button key={item.id} type="button" className={`flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] ${on ? "text-fg" : "text-muted"}`} onClick={() => { setView(item.id); setNavOpen(false); }}>
              <Icon className="size-4" />
              {item.label}
            </button>
          );
        })}
        <button type="button" className="flex min-h-14 flex-1 flex-col items-center justify-center text-[11px] text-muted" onClick={openNav}>
          <Menu className="size-4" />
          More
        </button>
      </nav>

      <VoiceModeOverlay
        open={voiceOverlayOpen}
        phase={overlayPhase}
        level={voiceLevel}
        muted={voiceMuted}
        mode={voiceMode}
        transcript={voiceLiveTranscript}
        notice={overlayNotice}
        error={overlayError ? presentVoiceCopy(overlayError) : overlayError}
        onMute={toggleVoiceMute}
        onClose={closeVoiceOverlay}
        onInterrupt={interruptVoiceOverlay}
        onRetry={() => void retryVoiceOverlay()}
      />
      <SpeakStage
        open={speakStageOpen}
        signedIn={statusSignedIn === true || (typeof window !== "undefined" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"))}
        live={voiceListening}
        onClose={() => { setSpeakStageOpen(false); void listen({ mode: "stop" }); }}
        onSignIn={() => { setSpeakStageOpen(false); window.location.assign("/login"); }}
        onLive={() => void listen({ mode: voiceListening ? "stop" : "start" })}
        onAsk={async (text) => {
          const turn = await speakChatTurn(text);
          if (!turn.ok) return turn.error;
          await speak(turn.text);
          return null;
        }}
      />
      <LiveVoiceBar
        compactIdle
        authReady={statusSignedIn === true}
        authSignedIn={statusSignedIn === true}
        onSignInRequired={() => setVoiceSignInNotice(true)}
        onCompactSpeak={() => void speak("")}
        onChatAttachImage={(image) => setPendingImages((prev) => prev.length >= 4 ? prev : [...prev, image])}
        onDictateToggle={() => startBrowserDictation()}
        isOverlayMicOpen={() =>
          Boolean(
            overlayOpenRef.current ||
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
        onChatSend={(text) => {
          const clipped = text.trim().slice(0, 8000);
          if (!clipped) return;
          if (active) {
            void deliver(active, clipped, ws);
            return;
          }
          setDraft(clipped);
          window.setTimeout(() => {
            void sendCommand();
          }, 0);
        }}
        onChatAttachText={(text, name) => {
          setDraft((prev) => (prev ? `${prev}\n\n${text}` : text));
          setNotice(`Attached ${name} into the composer (live was off).`);
        }}
        getVoiceProfile={() => {
          const chat = wsRef.current.chats.find((item) => item.id === activeId) ?? null;
          return {
            personalityId: chat?.personalityId ?? "assistant",
            customPersonality: chat?.customPersonality ?? "",
            characterId: readStoredCharacterId(typeof localStorage === "undefined" ? null : localStorage),
          };
        }}
      />
    </div>
  );
}

function BrowserDictationControl(props: {
  state: DictationMachineState["phase"];
  level: number;
  elapsedSec: number;
  disabled?: boolean;
  compact?: boolean;
  onMicClick: () => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2" data-testid="browser-dictation" title="Browser speech, not a realtime voice session">
      <DictationPill
        state={props.state}
        level={props.level}
        elapsedSec={props.elapsedSec}
        disabled={props.disabled}
        onMicClick={props.onMicClick}
        onStop={props.onStop}
        onCancel={props.onCancel}
      />
      {props.compact ? (
        <span className="sr-only">Browser speech, not a realtime voice session.</span>
      ) : (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Browser speech</span>
      )}
    </div>
  );
}

function presentVoiceCopy(text: string): string {
  if (/127\.0\.0\.1|localhost:\d+|0\.0\.0\.0:\d+|not reachable at https?:\/\//i.test(text)) {
    return "Orchestrator needs Ollama on a paired computer. Switch to Direct if it is unavailable.";
  }
  return text;
}

function VoiceModeButton(props: { onClick: () => void; pressed?: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      className={
        props.compact
          ? `focus-ring grid size-9 place-items-center rounded-full ${props.pressed ? "bg-accent text-accent-ink" : "text-muted"}`
          : `inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm ${props.pressed ? "bg-accent text-accent-ink" : "text-muted"}`
      }
      onClick={props.onClick}
      aria-label="Open voice mode"
      aria-pressed={props.pressed ?? false}
      data-testid="open-voice-mode"
      title="Realtime voice session. Not browser dictation."
    >
      <Mic className="size-4" />
      {props.compact ? <span className="sr-only">Voice mode</span> : "Voice mode"}
    </button>
  );
}

function Quick({ label, icon: Icon, tone, onClick, comingSoon, title }: { label: string; icon: typeof Folder; tone: string; onClick: () => void; comingSoon?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || (comingSoon ? "Coming soon — not wired yet" : undefined)}
      aria-disabled={comingSoon ? true : undefined}
      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-panel border border-line/80 bg-surface/80 px-3 text-sm shadow-[0_8px_24px_rgb(0_0_0/0.25)] backdrop-blur${comingSoon ? " is-coming-soon" : ""}`}
    >
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
        <button type="button" className="panel-action" onClick={onAction}>{action}</button>
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
      <span className={`status-pill rounded-full border border-line px-2 py-1 text-xs ${color}`}>{pill}</span>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="overlay-backdrop fixed inset-0 z-40 grid place-items-end p-4 md:place-items-center" role="dialog" aria-modal="true">
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
    <section className="page-shell px-4 pb-4 md:px-6">
      <div className="rea-layout mt-4 grid gap-3">
        <div className="dense-card card-texture p-4">
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted">{lead}</p>
          <p className="mt-4 text-sm font-semibold">What can run</p>
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
        <p className="min-w-0 whitespace-pre-wrap rounded-panel border border-line bg-surface p-4 text-sm text-muted">
          {report ?? "No REA report yet. A report appears only after you run doctor or inspect."}
        </p>
      </div>
    </section>
  );
}

function ChatPane({
  active,
  chats,
  personalityId,
  onPersonalityChange,
  customPersonality,
  onCustomPersonalityChange,
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
  voiceListening,
  voiceMuted,
  voiceLevel,
  onToggleMute,
  dictationState,
  dictationLevel,
  dictationElapsed,
  dictationDisabled,
  onDictationMic,
  onDictationStop,
  onDictationCancel,
  onOpenVoiceMode,
  voiceOverlayOpen,
  memoryChoice,
  mode,
  onMemoryChange,
  onComposerMode,
  composerEffort,
  onComposerEffort,
  routingMode,
  onRoutingMode,
  routingPanel,
  onToggleRoute,
  ratings,
  onRate,
  stagedName,
  pendingImages,
  onRemoveImage,
  onAttach,
  onAttachImage,
  onOpenCamera,
  onOpenCloud,
  onImagine,
  onEditImagine,
  onSaveImage,
  onDownloadImage,
  onAddImageFile,
  onAnalyze,
  onDoctor,
  providerChoices: choices,
  providerChoice,
  onProvider,
  modelTier,
  onModelTier,
  logicRoute = null,
  logicRoutes = [],
  onChooseLogic,
  toolTimeline,
  timelineNowMs,
  agentActivity,
  recentTasks,
  connectedServices,
  systemStatus,
  onViewAudit,
}: {
  active: Chat | null;
  chats: Chat[];
  personalityId: PersonalityId;
  onPersonalityChange: (personalityId: PersonalityId) => void;
  customPersonality: string;
  onCustomPersonalityChange: (value: string) => void;
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
  onSave: (content: string) => void;
  onNew: () => void;
  onSpeak: (text: string, messageId?: string) => void;
  onListen: () => void;
  onListenStop?: () => void;
  onLiveUserTranscript?: (text: string) => void;
  onLiveAssistantTranscript?: (text: string) => void;
  onLiveVoiceError?: (message: string) => void;
  onLiveVoiceNotice?: (message: string) => void;
  speaking: boolean;
  voiceListening: boolean;
  voiceMuted: boolean;
  voiceLevel: number;
  onToggleMute: () => void;
  dictationState: DictationMachineState["phase"];
  dictationLevel: number;
  dictationElapsed: number;
  dictationDisabled: boolean;
  onDictationMic: () => void;
  onDictationStop: () => void;
  onDictationCancel: () => void;
  onOpenVoiceMode: () => void;
  voiceOverlayOpen: boolean;
  memoryChoice: "off" | "on";
  mode: Autonomy;
  onMemoryChange: (next: "off" | "on") => void;
  onComposerMode: (mode: Autonomy) => void;
  composerEffort: ComposerModeId;
  onComposerEffort: (mode: ComposerModeId) => void;
  routingMode: RoutingMode;
  onRoutingMode: (mode: RoutingMode) => void;
  routingPanel: LogicRouteId[];
  onToggleRoute: (id: LogicRouteId) => void;
  ratings: ResponseRating[];
  onRate: (messageId: string, score: 1 | 2 | 3 | 4 | 5, model: string | null) => void;
  stagedName: string | null;
  pendingImages: ImageAttachment[];
  onRemoveImage: (index: number) => void;
  onAttach: () => void;
  onAttachImage: () => void;
  onOpenCamera: () => void;
  onOpenCloud: () => void;
  onImagine: () => void;
  onEditImagine: (src: string) => void;
  onSaveImage: (src: string, alt: string) => void;
  onDownloadImage: (src: string, alt: string) => void;
  onAddImageFile: (file: File) => void;
  onAnalyze: () => void;
  onDoctor: () => void;
  providerChoices: { id: string; label: string; enabled: boolean; reason: string }[];
  providerChoice: string;
  onProvider: (id: string) => void;
  modelTier: ModelTier;
  onModelTier: (tier: ModelTier) => void;
  logicRoute?: LogicRouteId | null;
  logicRoutes?: LogicRoutePublic[];
  onChooseLogic?: (route: LogicRouteId) => void;
  toolTimeline: ToolTimelineRow[];
  timelineNowMs: number;
  agentActivity: ReturnType<typeof agentActivityFromTimeline>;
  recentTasks: ReturnType<typeof recentTasksFromAudit>;
  connectedServices: ReturnType<typeof connectedServicesRail>;
  systemStatus: ReturnType<typeof systemStatusRail>;
  onViewAudit: (auditId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [tools, setTools] = useState(false);
  const [context, setContext] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [chromeNote, setChromeNote] = useState(
    "Voice chrome preview. Dictate uses this chat’s microphone. Speak, the live bar, and voice mode do not connect a provider.",
  );
  const [dictationTick, setDictationTick] = useState(0);
  const [previewModel, setPreviewModel] = useState<ComposerModelId>("heavy");
  const [previewModelOpen, setPreviewModelOpen] = useState(false);
  useEffect(() => {
    setRenaming(false);
    setEditingId(null);
  }, [active?.id]);
  useEffect(() => {
    if (!voiceListening) {
      setDictationTick(0);
      return;
    }
    const id = window.setInterval(() => setDictationTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [voiceListening]);
  const markPreview = (control: string) => {
    setChromeNote(`${control} is preview only. No voice provider is connected.`);
  };
  const grokVerified = Boolean(active?.messages.some((message) => message.role === "assistant" && typeof message.model === "string" && /grok/i.test(message.model)));
  const needle = filter.trim().toLowerCase();
  const scoped = projectId ? chats.filter((chat) => chat.projectId === projectId) : chats;
  const visible = needle ? scoped.filter((chat) => chat.title.toLowerCase().includes(needle)) : scoped;
  const groups = ["Today", "Yesterday", "This week", "Earlier"]
    .map((label) => ({ label, items: visible.filter((chat) => chatBucket(chat) === label) }))
    .filter((group) => group.items.length > 0);
  const lastReply = [...(active?.messages ?? [])].reverse().find((msg) => msg.role === "assistant");
  return (
    <div className="thread-shell flex h-full min-h-0 flex-col xl:flex-row">
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
        <div className="chat-head px-4 pt-4">
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
         <details className="thread-chat-settings">
           <summary>Chat settings</summary>
            <p className="text-sm text-muted">Only a configured provider can be selected. Another provider is not substituted.</p>
           <div className="mt-2 flex flex-wrap items-center gap-2">
           <label htmlFor="thread-personality" className="text-xs font-semibold text-muted">Conversation style</label>
           <select id="thread-personality" value={personalityId} onChange={(event) => onPersonalityChange(event.target.value as PersonalityId)} className="min-h-10 rounded-panel border border-line bg-surface px-3 text-sm" disabled={!active || busy}>
             {CONVERSATIONAL_PERSONALITIES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
           </select>
          </div>
          {active && personalityId === "custom" && (
            <div className="mt-2 max-w-xl space-y-1">
              <label htmlFor="thread-custom-personality" className="text-xs font-semibold text-muted">Describe EVE's conversation style</label>
              <textarea
                id="thread-custom-personality"
                value={customPersonality}
                onChange={(event) => onCustomPersonalityChange(event.target.value.slice(0, 800))}
                maxLength={800}
                rows={3}
                disabled={busy}
                placeholder="For example: concise, analytical, candid, and lightly humorous. Challenge weak assumptions respectfully."
                className="w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm"
                aria-describedby="thread-custom-personality-help"
              />
              <p id="thread-custom-personality-help" className="text-xs text-muted">Up to 800 characters. This changes tone and presentation only; it cannot change tools, access, approvals or safety rules.</p>
              <p className="text-right text-[11px] tabular-nums text-muted">{customPersonality.length}/800</p>
            </div>
          )}
          {active && (
            <div className="mt-3 max-w-md" data-testid="memory-chat-toggle-header">
              <MemoryChatToggle memory={memoryChoice} onChange={onMemoryChange} disabled={busy || halted} />
            </div>
          )}
          </details>
          <details className="thread-mobile-tools mt-3 xl:hidden">
            <summary className="min-h-11 cursor-pointer text-sm">Choose a provider</summary>
            <ProviderPicker name="mind-provider-mobile" choices={choices} choice={providerChoice} onChoose={onProvider} logicRoutes={logicRoutes} grokVerified={grokVerified} />
            <div className="mt-3">
              <ModelTierPicker name="mind-tier-mobile" tier={modelTier} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          {(!active || active.messages.length === 0) && !busy && (
            <div className="grid min-h-64 place-items-center text-center">
              <ChatEmptyHero />
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
                <MessageBody text={msg.content} images={msg.images} onEditImagine={(src) => onEditImagine(src)} onSaveImage={onSaveImage} onDownloadImage={onDownloadImage} />
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
                  <button type="button" className="min-h-11 text-xs text-accent" onClick={() => onSpeak(msg.content, msg.id)} disabled={speaking}>
                    {speaking ? "Speaking" : "Read aloud"}
                  </button>
                )}
                {msg.role === "assistant" && (
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    Rate
                    {([1, 2, 3, 4, 5] as const).map((score) => (
                      <button
                        key={score}
                        type="button"
                        className={`min-h-11 min-w-11 ${ratings.find((item) => item.messageId === msg.id)?.score === score ? "text-accent" : ""}`}
                        onClick={() => onRate(msg.id, score, msg.model ?? null)}
                      >
                        {score}
                      </button>
                    ))}
                  </span>
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
              {msg.role === "assistant" && msg.memorySaved === true ? (
                <div className="mt-2">
                  <MemorySavedIndicator memorySaved={true} savedMemoryId={msg.savedMemoryId} />
                </div>
              ) : null}
            </article>
            );
          })}
          {toolTimeline.length > 0 && (
            <div className="max-w-3xl rounded-panel border border-line bg-surface p-3" data-testid="executing-tools">
              {(() => {
                const counts = timelineCounts(toolTimeline);
                return (
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <span className={`inline-block size-2 rounded-full ${counts.failed ? "bg-danger" : counts.running ? "bg-accent" : "bg-ok"}`} />
                    Executing tools ({counts.done}/{counts.total})
                  </p>
                );
              })()}
              <ul className="space-y-2">
                {toolTimeline.map((row) => {
                  const ms = elapsedMs(row, timelineNowMs);
                  const failed = row.status === "failed" || row.status === "timed_out" || row.status === "cancelled";
                  const done = row.endedAtMs != null && !failed;
                  return (
                    <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-bg px-3 py-2 text-sm" data-testid="tool-timeline-row" data-status={row.status}>
                      <span className={`size-2 shrink-0 rounded-full ${failed ? "bg-danger" : done ? "bg-ok" : "bg-accent"}`} />
                      <span className="min-w-0 flex-1 font-medium">{row.name}</span>
                      <span className={`text-xs ${failed ? "text-danger" : "text-muted"}`}>{row.status}</span>
                      <span className="text-xs text-muted tabular-nums">{formatElapsed(ms)}</span>
                      {row.auditId ? (
                        <button type="button" className="min-h-11 text-xs text-accent" onClick={() => onViewAudit(row.auditId!)}>
                          View
                        </button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {busy && liveText && (
            <article className="max-w-3xl rounded-panel border border-line bg-surface px-3 py-2 text-sm">
              <p className="mb-1 text-xs text-muted">{modelTier} · writing</p>
              <p className="whitespace-pre-wrap">{liveText}</p>
            </article>
          )}
          {busy && !liveText && toolTimeline.length === 0 && (
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
          {error && <p className="voice-copy text-sm text-danger">{presentVoiceCopy(error)}</p>}
          {error && active?.messages.at(-1)?.role === "user" && (
            <button type="button" className="min-h-11 text-sm text-accent" disabled={busy || halted} onClick={onRetry}>Retry</button>
          )}
          {active && <p className="text-xs text-muted">Chat memory is {active.memory === "on" ? "on" : "off"} for this session. The agent session is on this device. Hosted realtime is not connected. The schedule worker is separate.</p>}
          <div className="flex items-center gap-2"><VoiceLevelMeter level={voiceLevel} listening={voiceListening} /></div>
        </div>
        <form
          className="floating-composer command-card composer-dock thread-composer m-3 p-3" data-composer="floating"
          onSubmit={(event) => {
            event.preventDefault();
            onSend();
          }}
          onDragOver={(event) => {
            if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => (file.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name));
            for (const file of files.slice(0, 4)) onAddImageFile(file);
          }}
        >
          <RoutingModeControl mode={routingMode} panel={routingPanel} onMode={onRoutingMode} onToggle={onToggleRoute} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            onPaste={(event) => {
              const items = Array.from(event.clipboardData?.items ?? []);
              const imageItems = items.filter((item) => item.type.startsWith("image/"));
              if (imageItems.length === 0) return;
              event.preventDefault();
              for (const item of imageItems.slice(0, 4)) {
                const file = item.getAsFile();
                if (file) onAddImageFile(file);
              }
            }}
            placeholder={`Message (${modelTier})...`}
            aria-label="Message"
            className="input-glow min-h-11 w-full rounded-xl bg-transparent px-1 text-sm outline-none"
          />
          <AttachmentChips images={pendingImages} onRemove={onRemoveImage} onEditImagine={(image) => onEditImagine(image.dataUrl)} />
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
              <p className="text-xs text-muted">Chat stays on Grok. Imagine generates images via grok-imagine-image. Video is not called.</p>
            </div>
          )}
          <div className="composer-toolbar mt-2 flex flex-wrap items-center gap-2">
           <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onAttach}>
             <Paperclip className="size-4" /> Attach
           </button>
            <details className="composer-more">
              <summary>More</summary>
              <div className="composer-more__menu">
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onAttachImage}>
                  <Image className="size-4" /> Image
                </button>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onOpenCamera}>
                  <Camera className="size-4" /> Camera
                </button>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onOpenCloud}>
                  Drive
                </button>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" disabled={busy || halted} onClick={onImagine}>
                  Imagine
                </button>
                <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={() => { setContext((open) => !open); setTools(false); }}>Add Context</button>
                <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={() => { setTools((open) => !open); setContext(false); }}>Tools</button>
                <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={onDelete} disabled={!active}>Delete</button>
                <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" onClick={() => onMemoryChange(memoryChoice === "on" ? "off" : "on")} disabled={!active || busy || halted} aria-label={memoryChoice === "on" ? "Memory on for this chat" : "Don't use memory for this chat"}>{memoryChoice === "on" ? "Memory on" : "Memory off"}</button>
              </div>
            </details>
            <div className="legacy-composer-voice"><VoiceLevelMeter level={voiceLevel} listening={voiceListening} />
            <BrowserDictationControl
              state={dictationState}
              level={dictationLevel}
              elapsedSec={dictationElapsed}
              disabled={dictationDisabled}
              onMicClick={onDictationMic}
              onStop={onDictationStop}
              onCancel={onDictationCancel}
            />
            <VoiceModeButton pressed={voiceOverlayOpen} onClick={onOpenVoiceMode} />
            <VoiceWaveform level={voiceLevel} active={voiceListening || speaking} className="ml-auto" />
            <button type="button" title={voiceMicAriaLabel(voiceListening)} className={`grid size-11 place-items-center rounded-panel border border-line ${voiceListening ? "bg-accent text-accent-ink" : ""}`} onClick={onListen} aria-label={voiceMicAriaLabel(voiceListening)} aria-keyshortcuts={VOICE_TOGGLE_SHORTCUT.ariaKeyshortcuts} aria-pressed={voiceListening}>
              {voiceListening ? <Square className="size-4" /> : <Mic className="size-4" />}
            </button>
            <button type="button" className="grid size-11 place-items-center rounded-panel border border-line text-muted" onClick={onToggleMute} aria-label={voiceMuted ? "Unmute microphone" : "Mute microphone"} aria-pressed={voiceMuted} disabled={!voiceListening} data-testid="voice-mute-mobile">
              {voiceMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </button>
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" disabled={!lastReply || speaking} onClick={() => lastReply && onSpeak(lastReply.content, lastReply.id)}>
              {speaking ? "Reading" : "Read aloud"}
            </button></div>
            
            <ComposerEffortControl mode={composerEffort} onChoose={onComposerEffort} />
            <label className="inline-flex min-h-11 items-center gap-2 text-xs text-muted">
              Style
              <select aria-label="Conversation style" value={personalityId} disabled={!active || busy} onChange={(event) => onPersonalityChange(event.target.value as PersonalityId)} className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm text-fg">
                {CONVERSATIONAL_PERSONALITIES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy || halted || (!draft.trim() && pendingImages.length === 0 && !stagedName)} className="composer-send min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">Send</button>
          </div>
          <div className="composer-voice-chrome" data-testid="composer-voice-chrome" hidden aria-hidden="true">
            <p className="text-xs text-muted" role="status">{chromeNote}</p>
            <div className="composer-voice-chrome__row">
              <PreviewDictationPill
                state={voiceListening ? "recording" : "idle"}
                level={voiceLevel}
                elapsedSec={voiceListening ? dictationTick : 0}
                onStart={() => {
                  setChromeNote("Dictate uses this chat’s microphone. It does not start a live voice provider.");
                  onListen();
                }}
                onStop={() => {
                  setChromeNote("Dictation stopped. No voice provider is connected.");
                  (onListenStop ?? onListen)();
                }}
                onCancel={() => {
                  setChromeNote("Dictation cancelled. No voice provider is connected.");
                  (onListenStop ?? onListen)();
                }}
              />
              <ComposerBar
                className="composer-voice-chrome__bar"
                model={previewModel}
                modelMenuOpen={previewModelOpen}
                dictationState={voiceListening ? "recording" : "idle"}
                speakState="off"
                level={voiceListening ? voiceLevel : 0}
                placeholder="Preview only — not a second composer"
                askSlot={<span className="text-xs text-muted">Preview only. This chip does not change the chat model or send a message.</span>}
                onPlus={() => markPreview("Add attachment")}
                onModelToggle={() => setPreviewModelOpen((open) => !open)}
                onModelSelect={(id) => {
                  setPreviewModel(id);
                  setPreviewModelOpen(false);
                  markPreview("Model chip");
                }}
                onDictate={() => setChromeNote("Use the single Speak control for a realtime conversation.")}
                onSpeak={() => markPreview("Speak")}
              />
              <LiveSpeakControl
                state="off"
                level={0}
                label="Not connected"
                onToggle={() => markPreview("Live speak")}
                onMute={() => markPreview("Live speak mute")}
                onEnd={() => markPreview("Live speak end")}
              />
            </div>
            <VoiceModeStage
              open
              overlay={false}
              state="idle"
              level={0}
              modeLabel="Preview only — no voice provider is connected."
              muted={false}
              onMute={() => markPreview("Voice mode mute")}
              onEnd={() => markPreview("Voice mode end")}
            />
            <PresentationalLiveVoiceBar
              state="off"
              level={0}
              placeholder="Preview only — not a live call"
              askSlot={<span className="text-xs text-muted">Preview only. Not a connected voice session. Type in the composer above.</span>}
              onMute={() => markPreview("Live bar mute")}
              onEnd={() => markPreview("Live bar end")}
              onSpeaker={() => markPreview("Speaker")}
              onScreenShare={() => markPreview("Screen share")}
              onSettings={() => markPreview("Voice settings")}
              onPlus={() => markPreview("Add attachment")}
              onPlusItem={(id) => markPreview(`Add ${id}`)}
              onAskFocus={() => markPreview("Live bar ask")}
            />
          </div>
        </form>
      </section>
      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-auto border-l border-line/70 p-3 xl:flex" data-testid="chat-right-rail">
        <section className="glass-panel rounded-panel p-3">
          <ProviderPicker name="mind-provider-side" choices={choices} choice={providerChoice} onChoose={onProvider} logicRoutes={logicRoutes} grokVerified={grokVerified} />
        </section>
        <details className="rail-pack">
          <summary>Mode</summary>
          <section className="glass-panel rounded-panel p-3">
            <ModelTierPicker name="mind-tier-side" tier={modelTier} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />
          </section>
        </details>
        <details className="rail-pack">
          <summary>This chat</summary>
          <section className="glass-panel rounded-panel p-3">
          <button type="button" onClick={() => onComposerMode("ask")} className={`mb-2 min-h-11 w-full rounded-panel px-3 text-left text-sm ${mode === "ask" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80"}`}>Ask</button>
          <button type="button" onClick={() => onComposerMode("automatic")} className={`min-h-11 w-full rounded-panel px-3 text-left text-sm ${mode === "automatic" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80"}`}>Automatic</button>
          </section>
          <section className="glass-panel rounded-panel p-3" data-testid="memory-chat-toggle-rail">
          <MemoryChatToggle memory={memoryChoice} onChange={onMemoryChange} disabled={!active || busy || halted} />
          <p className="mt-2 text-xs text-muted">Off means this chat cannot read or save notes.</p>
        </section>
        </details>
        <details className="rail-pack">
          <summary>Activity</summary>
          <section className="glass-panel rounded-panel p-3 text-sm" data-testid="agent-activity-live">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">Agent Activity</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${agentActivity.live ? "bg-ok/20 text-ok" : "bg-surface-2 text-muted"}`}>
              {agentActivity.live ? "Live" : "Idle"}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">{agentActivity.label}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full ${agentActivity.live ? "bg-accent" : agentActivity.percent > 0 ? "bg-ok" : "bg-transparent"}`} style={{ width: `${agentActivity.percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {agentActivity.total === 0
              ? agentActivity.detail
              : `Step ${agentActivity.step} of ${agentActivity.total}: ${agentActivity.detail}`}
          </p>
        </section>
        <section className="glass-panel rounded-panel p-3 text-sm" data-testid="recent-tasks">
          <p className="font-semibold">Recent Tasks</p>
          {recentTasks.length === 0 && <p className="mt-2 text-xs text-muted">No tasks yet. Actions you take show up here.</p>}
          <ul className="mt-2 space-y-2">
            {recentTasks.map((task) => (
              <li key={task.id} className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium">{task.label}</span>
                <span className="shrink-0 text-muted">{task.result}</span>
              </li>
            ))}
          </ul>
        </section>
        </details>
        <details className="rail-pack">
          <summary>Connections</summary>
          <section className="glass-panel rounded-panel p-3 text-sm" data-testid="connected-services-rail">
          <p className="font-semibold">Connected Services</p>
          <ul className="mt-2 space-y-2">
            {connectedServices.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-2 text-xs">
                <span>{item.name}</span>
                <span className={item.tone === "ok" ? "text-ok" : item.tone === "danger" ? "text-danger" : "text-muted"}>{item.state}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass-panel rounded-panel p-3 text-sm" data-testid="system-status-rail">
          <p className="font-semibold">System Status</p>
          <p className="mt-1 text-xs text-muted">{systemStatus.headline}</p>
          <ul className="mt-2 space-y-2">
            {systemStatus.rows.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-2 text-xs">
                <span>{row.name}</span>
                <span className={row.ok ? "text-ok" : "text-muted"}>{row.state}</span>
              </li>
            ))}
          </ul>
        </section>
        </details>
        <section className="glass-panel rounded-panel p-3 text-sm">
          <p className="font-semibold">{active?.title ?? "New session"}</p>
          <p className="text-xs text-muted">On this device · Memory {memoryChoice}</p>
        </section>
        <div className={`voice-zone-rail ${speaking ? "is-live" : ""}`} aria-label="Voice controls">
          <button type="button" className="focus-ring grid size-11 place-items-center rounded-full border border-line/80" onClick={onListen} aria-label={voiceMicAriaLabel(voiceListening)}>
            <Mic className="size-4" />
          </button>
          <span className="waveform" aria-hidden="true"><span /><span /><span /><span /><span /></span>
          <button type="button" className="focus-ring grid size-11 place-items-center rounded-full border border-line/80" disabled={!lastReply || speaking} onClick={() => lastReply && onSpeak(lastReply.content, lastReply.id)} aria-label="Speak">
            <Volume2 className="size-4" />
          </button>
        </div>
      </aside>
    </div>
  );
}

function RoutingModeControl({
  mode,
  panel,
  onMode,
  onToggle,
}: {
  mode: RoutingMode;
  panel: LogicRouteId[];
  onMode: (mode: RoutingMode) => void;
  onToggle: (id: LogicRouteId) => void;
}) {
  const modes: RoutingMode[] = ["A", "B", "C", "D"];
  return (
    <details className="mb-2" data-testid="routing-mode">
      <summary className="min-h-11 cursor-pointer text-sm">Routing · {ROUTING_MODE_LABEL[mode]}</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Routing</span>
        {modes.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            className={`min-h-11 rounded-full px-3 text-sm ${mode === item ? "bg-accent text-accent-ink tile-active" : "border border-line/80 bg-white/5 text-muted"}`}
            onClick={() => onMode(item)}
          >
            {item} {ROUTING_MODE_LABEL[item]}
          </button>
        ))}
      </div>
      {mode !== "A" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Routes</span>
          {(["astra", "sol", "luna"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={panel.includes(id)}
              className={`min-h-11 rounded-full px-3 text-sm ${panel.includes(id) ? "bg-accent text-accent-ink tile-active" : "border border-line/80 bg-white/5 text-muted"}`}
              onClick={() => onToggle(id)}
            >
              {id}
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 text-xs text-muted">
        {mode === "A" && "One model answers. Nothing else is called."}
        {mode === "B" && "Two ready routes answer. Both replies stay. Nothing is merged."}
        {mode === "C" && "Each selected ready route answers on its own. Nothing is merged."}
        {mode === "D" && "Selected ready routes stay side by side. Nothing is merged."}
      </p>
    </details>
  );
}

function ComposerEffortControl({
  mode,
  onChoose,
}: {
  mode: ComposerModeId;
  onChoose: (mode: ComposerModeId) => void;
}) {
  const resolved = resolveSendPath(mode);
  const current = COMPOSER_MODES.find((item) => item.id === mode) ?? COMPOSER_MODES[0];
  return (
    <div className="composer-effort" data-testid="composer-effort">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Effort</span>
        {COMPOSER_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            className={`min-h-11 rounded-full px-3 text-sm ${mode === item.id ? "bg-accent text-accent-ink tile-active" : "border border-line/80 bg-white/5 text-muted"}`}
            onClick={() => onChoose(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{resolved.badge}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {current?.detail}
        {resolved.notice ? ` ${resolved.notice}` : ""}
      </p>
    </div>
  );
}

const VOICE_PERSONALITIES: { id: VoicePersonality; label: string }[] = [
  { id: "new", label: "New" },
  { id: "adrian", label: "Adrian" },
  { id: "assistant", label: "Assistant" },
  { id: "therapist", label: "Therapist" },
];

const VOICE_ACTIVATIONS: { id: VoiceActivation; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "isolation", label: "Isolation" },
  { id: "push_to_talk", label: "Push to talk" },
];

const VOICE_SPEEDS: { id: VoiceSpeed; label: string }[] = [
  { id: "slow", label: "Slow" },
  { id: "normal", label: "Normal" },
  { id: "fast", label: "Fast" },
];

function VoiceSettingsBlock() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  useEffect(() => {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    setSettings(loadVoiceSettings(storage));
  }, []);
  function update(patch: Partial<VoiceSettings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      const storage = typeof localStorage === "undefined" ? null : localStorage;
      saveVoiceSettings(storage, next);
      if (patch.speed && storage) {
        const pace = patch.speed === "slow" ? "slow" : patch.speed === "fast" ? "brisk" : "natural";
        storage.setItem("adrian-speak-rate", pace);
      }
      return next;
    });
  }
  return (
    <div className="settings-card card-texture rounded-panel p-4 text-sm" data-testid="voice-settings">
      <p className="font-semibold">Voice</p>
      <p className="text-muted">Speak uses the voice key on this computer. These choices stay in this browser.</p>
      <div className="settings-row mt-3">
        <div>
          <p className="font-semibold">Personality</p>
          <p className="text-muted">Saved on this device. Chat style is separate.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {VOICE_PERSONALITIES.map((item) => (
            <button key={item.id} type="button" aria-pressed={settings.personality === item.id} className={`min-h-11 rounded-panel border px-3 ${settings.personality === item.id ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => update({ personality: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div>
          <p className="font-semibold">Activation</p>
          <p className="text-muted">Saved on this device. Record still starts the call.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {VOICE_ACTIVATIONS.map((item) => (
            <button key={item.id} type="button" aria-pressed={settings.activation === item.id} className={`min-h-11 rounded-panel border px-3 ${settings.activation === item.id ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => update({ activation: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div>
          <p className="font-semibold">Speed</p>
          <p className="text-muted">Slow, natural, or brisk. Speak uses this pace next time it opens.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {VOICE_SPEEDS.map((item) => (
            <button key={item.id} type="button" aria-pressed={settings.speed === item.id} className={`min-h-11 rounded-panel border px-3 ${settings.speed === item.id ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => update({ speed: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModelTierPicker({
  name,
  tier,
  onChoose,
  logicRoute = null,
  logicRoutes = [],
  onChooseLogic,
}: {
  name: string;
  tier: ModelTier;
  onChoose: (tier: ModelTier) => void;
  logicRoute?: LogicRouteId | null;
  logicRoutes?: LogicRoutePublic[];
  onChooseLogic?: (route: LogicRouteId) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">Mode</legend>
      <p className="text-xs text-muted">Grok modes use the tier models. Astra, Sol, and Luna follow provider.status.</p>
      {MODEL_TIERS.map((item) => (
        <label key={item} className="flex items-start gap-2 text-sm">
          <input type="radio" name={name} checked={logicRoute == null && tier === item} onChange={() => onChoose(item)} className="mt-1" />
          <span className="font-medium">{item}</span>
        </label>
      ))}
      {LOGIC_ROUTES.map((id) => {
        const view = logicRoutes.find((item) => item.id === id);
        const menu = logicMenuState(view, id);
        return (
          <label key={id} className={`flex items-start gap-2 text-sm ${menu.selectable ? "" : "opacity-70"}`} data-testid={`logic-route-radio-${id}`}>
            <input
              type="radio"
              name={name}
              className="mt-1"
              checked={logicRoute === id}
              disabled={!menu.selectable}
              onChange={() => {
                if (menu.selectable) onChooseLogic?.(id);
              }}
            />
            <span>
              <span className="font-medium">{menu.label}{view ? ` · ${view.state}` : ""}</span>
              <span className="block text-xs text-muted">{menu.detail}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function ProviderPicker({
  name,
  choices,
  choice,
  onChoose,
  logicRoutes = [],
  grokVerified = false,
}: {
  name: string;
  choices: { id: string; label: string; enabled: boolean; reason: string }[];
  choice: string;
  onChoose: (id: string) => void;
  logicRoutes?: LogicRoutePublic[];
  grokVerified?: boolean;
}) {
  const groupOf = (item: { id: string; label: string }) => {
    const label = item.label.toLowerCase();
    if (item.id === "grok" || label.startsWith("grok")) return "Grok";
    if (item.id === "openai" || label.includes("gpt") || label.includes("astra") || label.includes("sol") || label.includes("luna")) return "OpenAI";
    if (item.id.startsWith("custom:")) return "Saved";
    return "Other";
  };
  const groups = ["Grok", "OpenAI", "Other", "Saved"].map((title) => ({
    title,
    items: choices.filter((item) => groupOf(item) === title),
  })).filter((group) => group.items.length > 0);
  const selected = choices.find((item) => item.id === choice);
  return (
    <div className="provider-pack">
      <p className="text-sm font-semibold">Providers</p>
      <p className="mt-1 text-xs text-muted">{selected ? selected.label : "Choose a provider"}</p>
      {groups.map((group) => (
        <details key={group.title} className="provider-group" open={group.items.some((item) => item.id === choice) || undefined}>
          <summary>{group.title}</summary>
          {group.items.map((item) => (
            <label key={item.id} className={`flex items-start gap-2 rounded-xl px-2 py-2 text-sm ${choice === item.id ? "model-option-active" : ""} ${!item.enabled ? "opacity-60" : ""}`}>
              <input type="radio" name={name} className="mt-1" checked={choice === item.id} disabled={!item.enabled} onChange={() => { if (item.enabled) onChoose(item.id); }} />
              <span>
                {item.label}
                {item.id === "grok" && item.enabled ? <span className="text-muted"> · {grokVerified ? "A reply in this chat came from Grok" : "Configured"}</span> : null}
                <span className="block text-xs text-muted">{item.reason}</span>
              </span>
            </label>
          ))}
        </details>
      ))}
      <details className="provider-group">
        <summary>Routes</summary>
        {LOGIC_ROUTES.map((id) => {
        const view = logicRoutes.find((item) => item.id === id);
        const menu = logicMenuState(view, id);
        return (
          <label key={id} className={`flex items-start gap-2 rounded-xl px-2 py-2 text-sm ${choice === id ? "model-option-active" : ""} ${menu.selectable ? "" : "opacity-70"}`}>
            <input type="radio" name={name} className="mt-1" checked={choice === id} disabled={!menu.selectable} onChange={() => { if (menu.selectable) onChoose(id); }} />
            <span>
              {menu.label}{view ? ` · ${view.state}` : ""}
              <span className="block text-xs text-muted">{menu.detail}</span>
            </span>
          </label>
        );
      })}
      </details>
    </div>
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
