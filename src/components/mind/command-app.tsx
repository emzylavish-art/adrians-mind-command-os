import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useSyncExternalStore } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import "./command-drawer-nav.css";
import "./command-search.css";
import "./command-voice-mode.css";
import "./gpt-shell.css";
import "./visual-system.css";
import { getBearerToken } from "@/lib/auth/client";
import { loadMcpWithHttpFallback } from "@/lib/mind/mcp-list-http";
import { getRecentChats } from "@/lib/mind/recent-chats";
import { ConversationSections } from "@/components/mind/conversation-sections";
import { CloudBrowserSettings } from "@/components/mind/cloud-browser-settings";
import { PUBLIC_INSTALLER } from "@/lib/mind/desktop-update-info";
import { NativeDevicePanel } from "@/components/mind/native-device-panel";
import { DesktopUpdateNote } from "@/components/mind/desktop-update-note";
import { ActionOverlay, ActionsButton } from "@/components/mind/conversation-menu";
import { applyArchive, applyFavorite, applyProject, applyRename, conversationSharePath, quoteIntoNewChat, scheduleConversation, type ConversationAction } from "@/lib/mind/conversation-actions";
import { conversationSection, HIDDEN_SETTINGS_SECTIONS_KEY, hideSection, readHiddenSections, removeConversations, restoreSection } from "@/lib/mind/conversation-sections";
import { resolveShare, sameShareLocation, shareMissLabel, shareWriteDropsMissing, shareWriteForView, writeShareSearch } from "@/lib/mind/app-location";
import { routeForBotChat } from "@/lib/mind/bot-model";
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
  LayoutDashboard,
  MessageSquare,
  Mic,
  MicOff,
  Paperclip,
  Camera,
  ChevronDown,
  Plus,
  Search,
  Send,
  Settings,
  Shield,
  Square,
  Video,
  CalendarClock,
  CircleHelp,
  Compass,
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
import { consumeMindTurn, prepareTurnId, shouldStoreReply, STOPPED_REPLY } from "@/lib/mind/live-turn";
import { boundAbortSignal } from "@/lib/mind/turn-timeouts";
import { createVoiceClientSecret, mcpCommand, mcpList, mcpRemove, mcpRegistryList, mcpRegistryToggle, mcpSave, mindStatus, notionCommand, notionStatus, recordAgentExecution, searchWeb, setExecutionHalt, speakText } from "@/lib/mind/server";
import { focusConnection } from "./focus-connection";
import { listNotionWorkspaces } from "@/lib/mind/notion-workspaces";
import { SafeKeysPanel } from "@/components/mind/safe-keys-panel";
import { AiProviderConnections } from "@/components/mind/ai-provider-connections";
import type { PublicAiProvider } from "@/lib/mind/ai-provider-config.server";
import { VoiceWaveform } from "@/components/mind/voice-waveform";
import { VoiceLevelMeter } from "@/components/mind/voice-level-meter";
import { VoiceLiveTranscript } from "@/components/mind/voice-live-transcript";
import { VoicePicker } from "@/components/mind/voice-picker";
import { LiveVoiceBar } from "@/components/mind/live-voice-bar";
import { VoiceCloningStudioPage } from "@/components/mind/voice-cloning-studio/voice-cloning-studio";
import { DictationPill } from "@/components/mind/dictation-pill";
import { VoiceModeOverlay, type VoiceOverlayPhase } from "@/components/mind/voice-mode-overlay";
import { SpeakStage } from "@/components/mind/speak-stage";
import { HUMAN_CODE_NOTE, HumanCodePanel, isIntelligenceThread } from "@/components/mind/human-code-panel";
import { SpeakPanel } from "@/components/mind/surfaces/speak-panel";
import { SharedFleet } from "@/components/mind/shared-fleet";
import { ChatEmptyHero } from "@/components/mind/chat-empty-hero";
import {
  ComposerBar,
  type ComposerModelId,
  DictationPill as PreviewDictationPill,
  LiveSpeakControl,
  LiveVoiceBar as PresentationalLiveVoiceBar,
  VoiceModeStage,
} from "@/components/mind/voice-ui";

const DashboardApp = lazy(() => import("@/components/mind/agent-command-center").then((mod) => ({ default: mod.AgentCommandCenter })));
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
import { sanitizeAudioFilename } from "@/lib/mind/voice/voice-input";
import { captureSpeakUtterance } from "@/lib/mind/voice/capture-utterance";
import { type SpeakRetryParams } from "@/lib/mind/voice/speak-action";
import { runMountedSpeak } from "@/lib/mind/voice/speak-click";
import { speakCanRetry } from "@/lib/mind/voice/speak-failures";
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
import { createCallHistory, type CallHistory } from "@/lib/mind/voice/voice-chat-turn";
import type { Chat, Msg, Workspace } from "@/lib/mind/types";
import { ServiceBoard } from "@/components/mind/service-board";
import { EveWorkbench } from "@/components/mind/eve-workbench";
import { FleetPanel } from "@/components/mind/fleet-panels";
import { BuildWorkspace } from "@/components/mind/build-workspace";
import { ResearchPanel } from "@/components/mind/surfaces/research-panel";
import { AnswerTabs, MessageBody } from "@/components/mind/message-body";
import { MemorySavedIndicator } from "@/components/mind/memory-saved-indicator";
import { MemoryChatToggle } from "@/components/mind/memory-chat-toggle";
import { AttachmentChips } from "@/components/mind/media/attachment-chips";
import { CameraCapture } from "@/components/mind/media/camera-capture";
import { CloudPicker, type CloudPickerAttach } from "@/components/mind/media/cloud-picker";
import { InlineImage } from "@/components/mind/media/inline-image";
import { ChatMediaGallery } from "@/components/mind/media/chat-media-gallery";
import { explainRejectedImageFile } from "@/components/mind/media/accept-image-files";
import { imageDownloadName, listChatGalleryImages } from "@/lib/mind/media/chat-gallery";
import { fileToDownscaledDataUrl } from "@/components/mind/media/downscale";
import { historyTextForImages, parseImagineCommand, toImageAttachments, type ImageAttachment } from "@/lib/mind/media";
import { haltFleet, enqueueRun, runDueSchedules, togglePin } from "@/lib/mind/fleet";
import { tickFleet } from "@/lib/mind/fleet";
import { createBotFromSpeech, parseCreateBot } from "@/lib/mind/speak-bot";
import { interpretCommand, type CommandMode } from "@/lib/mind/intent";
import { notionSearchIssue, retainActivity } from "@/lib/mind/connection-attention";
import { paletteHits } from "@/lib/mind/palette";
import { paletteKeyAction } from "@/lib/mind/palette-keys";
import { runLocalPlan } from "@/lib/mind/local-tools";
import { greeting } from "@/lib/mind/greeting";
import { relevantMemories } from "@/lib/mind/memory/relevant";
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
import { AnchoredCard, MenuCluster, MenuGroup, MenuMotion, MenuShelf, ComposerMore, finishMenu, menuChip, pinShelf } from "@/components/mind/menu-material";
import { MODEL_TIERS, type ConcreteModelTier, type ModelTier } from "@/lib/mind/model-tiers";
import { chosenProvider, failover, providerChoicesWithKeys } from "@/lib/mind/providers";
import { discoveredCapabilities, mcpToolCallText } from "@/lib/mind/provider-catalog";
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
import { runSkill, runRequestedSkill, searchSkills, SKILLS } from "@/lib/mind/skills";
import LocalSkillsTools from "@/components/mind/local-skills-tools";
import { HandyDictation } from "@/components/mind/handy-dictation";
import { detectWithHandy } from "@/lib/mind/handy-dictation";
import { ModuleSuggestions } from "@/components/mind/module-suggestions";
import { type ModuleSuggestion } from "@/lib/intent/module-suggestions";

import { exportChat, prepareRegenerate, prepareRetry, renameChat, reviseUserTurn } from "@/lib/mind/transcript";
import { replyActions, replyHasSources } from "@/lib/mind/reply-actions";
import { useComposerDraft } from "@/lib/mind/use-composer-draft";
import { useMindWorkspace } from "@/lib/mind/use-mind-workspace";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { COMPOSER_MODES, effortForModelTier, effortModelTier, loadComposerEffort, resolveSendPath, saveComposerEffort, type ComposerModeId } from "@/lib/mind/composer-modes";
import { ADRIAN_MIND_IDENTITY, builtinModules, customModules, loadConsultModel, planModelConsult, saveConsultModel, type ConsultModule } from "@/lib/mind/model-consult";
import { planRouting, readRatings, readRoutingMode, readRoutingPanel, ROUTING_MODE_LABEL, saveRating, writeRoutingMode, writeRoutingPanel, type ResponseRating, type RoutingMode } from "@/lib/mind/routing-modes";
import { canSend } from "@/lib/mind/send-gate";
import { cueMessage, dropCued, restoreCue, takeNextCue, type CuedMessage } from "@/lib/mind/message-cue";
import { saveFailureMessage } from "@/lib/mind/save-error";
import { resetVoice } from "@/lib/mind/settings-reset";
import { FirstSteps } from "@/components/mind/first-steps";
import { applyMotionChoice, MOTION_KEY, readMotionChoice, type MotionChoice } from "@/lib/mind/apple-motion";
import { FIRST_STEPS_KEY, readFirstSteps, reopenFirstSteps, type FirstStepId, type FirstStepsState } from "@/lib/mind/first-steps";
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
  imageRetryPlan,
  mcpToolFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "@/lib/mind/failure-states";
import { eveAccessNotes } from "@/lib/mind/eve-access";
import { createTaskRecorder, recordingEndsWithDocument } from "@/lib/mind/task-recording";
import { decideComputerAction, spokenPcCommand } from "@/lib/mind/computer-control";
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
  PROJECT_NAME_MAX,
  addLocalFile,
  addMemory,
  emptyWorkspace,
  deleteMemory,
  workspaceForChat,
  addProject,
  archiveMessagePreview,
  clearedBrowserCopy,
  createChat,
  openBotChat,
  loadWorkspace,
  memoriesForChat,
  mergeWorkspace,
  replaceFromArchive,
  packWorkspace,
  pushAudit,
  pushUsage,
  sha256,
  reviseMemory,
  unpackWorkspace,
  updateChatPersonality,
  updateChatCustomPersonality,
} from "@/lib/mind/workspace";
import { WORKSPACE_ROUTE_LINKS } from "@/lib/mind/workspace-nav";
import { CONVERSATIONAL_PERSONALITIES, resolvePersonalityId, type PersonalityId } from "@/lib/mind/personalities";
import { clearPersonaSelection, readPersonaSelection } from "@/lib/mind/personas/selection";

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
  | "code"
  | "scheduled"
  | "integrations"
  | "activity"
  | "help"
  | "skills"
  | "voice"
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

const EMPTY_DRAFT_IMAGES: ImageAttachment[] = [];

type Staged = { name: string; text: string };

function pinRailScroll(node: HTMLElement | null) {
  node?.style.setProperty("overflow-x", "hidden", "important");
  node?.style.setProperty("overflow-y", "auto", "important");
  node?.style.setProperty("min-height", "0", "important");
  node?.style.setProperty("flex", "1 1 auto", "important");
}
function pinRailFrame(node: HTMLElement | null) {
  if (!node) return;
  node.style.setProperty("flex-direction", "column", "important");
  node.style.setProperty("min-height", "0", "important");
  node.style.setProperty("overflow", "hidden", "important");
}
function pinMainColumn(node: HTMLElement | null) {
  if (!node) return;
  node.style.setProperty("display", "flex", "important");
  node.style.setProperty("flex-direction", "column", "important");
  node.style.setProperty("min-height", "0", "important");
  node.style.setProperty("overflow", "hidden", "important");
}
function pinPageScroller(node: HTMLDivElement | null) {
  if (!node) return;
  node.style.setProperty("position", "relative", "important");
  node.style.setProperty("flex", "1 1 auto", "important");
  node.style.setProperty("min-height", "0", "important");
  node.style.setProperty("overflow-y", "auto", "important");
  const bar = document.querySelector("[data-testid='handy-dictation']");
  const gap = bar instanceof HTMLElement ? Math.ceil(bar.getBoundingClientRect().height) + 16 : 72;
  node.style.setProperty("padding-bottom", `var(--page-scroll-bottom, ${gap}px)`, "important");
}
function showRailLabel(node: HTMLElement | null) {
  node?.style.setProperty("display", "block", "important");
}
const NAV_GROUPS: { label: string; items: { id: View; label: string; icon: typeof Home }[] }[] = [
  {
    label: "Work",
    items: [
      { id: "build", label: "Build", icon: Terminal },
      { id: "code", label: "Intelligence", icon: MessageSquare },
      { id: "research", label: "Research", icon: Search },
      { id: "projects", label: "Projects", icon: Folder },
      { id: "files", label: "Library", icon: FileText },
    ],
  },
  {
    label: "Connect",
    items: [
      { id: "connected", label: "Plugins", icon: Zap },
      { id: "scheduled", label: "Scheduled", icon: CalendarClock },
    ],
  },
];

const MORE_NAV: { id: View; label: string; icon: typeof Home }[] = [
  { id: "intelligence", label: "Intelligence Layer", icon: Bot },
  { id: "agents", label: "Bots", icon: Bot },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "skills", label: "Skills", icon: Zap },
  { id: "voice", label: "Voice clone", icon: Volume2 },
  { id: "runs", label: "Runs", icon: CalendarClock },
  { id: "memory", label: "Memory", icon: Database },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "help", label: "Help", icon: CircleHelp },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

const NAV_MARKS: Record<string, string> = {
  build: "/brand/marks/build.png",
  code: "/brand/marks/chat.png",
  research: "/brand/marks/research.png",
  projects: "/brand/marks/projects.png",
  files: "/brand/marks/library.png",
  connected: "/brand/marks/plugins.png",
  scheduled: "/brand/marks/scheduled.png",
  intelligence: "/brand/marks/eve.png",
  agents: "/brand/marks/bots.png",
  tools: "/brand/marks/tools.png",
  skills: "/brand/marks/skills.png",
  voice: "/brand/marks/voice.png",
  runs: "/brand/marks/calendar.png",
  memory: "/brand/marks/memory.png",
  activity: "/brand/marks/activity.png",
  help: "/brand/marks/help.png",
};

function navMark(id: string): string {
  return NAV_MARKS[id] ?? "/brand/logo-mark.jpg";
}

const TITLES: Record<View, string> = {
  command: "Chat",
  intelligence: "Intelligence Layer",
  chat: "Thread",
  projects: "Projects",
  memory: "Memory",
  agents: "Bots & Agents",
  runs: "Runs",
  research: "Research",
  files: "Library",
  build: "Build",
  code: "Intelligence",
  connected: "Connected",
  tools: "Tools",
  skills: "Skills",
  voice: "Voice clone",
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
  supabase: "supabase",
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

const PRODUCT_LOGO: Record<string, string> = {
  grok: "/brand/logos/grok.svg",
  openai: "/brand/logos/openai.svg",
  claude: "/brand/logos/claude.svg",
  gemini: "/brand/logos/gemini.svg",
  openrouter: "/brand/logos/openrouter.svg",
  vercel: "/brand/logos/vercel.svg",
  gmail: "/brand/logos/gmail.svg",
  notion: "/brand/logos/notion.svg",
  github: "/brand/logos/github.svg",
  mcp: "/brand/logos/mcp.svg",
  supabase: "/brand/logos/supabase.svg",
  drive: "/brand/logos/drive.svg",
  calendar: "/brand/logos/calendar.svg",
  slack: "/brand/logos/slack.svg",
  youtube: "/brand/logos/youtube.svg",
  docs: "/brand/logos/docs.svg",
};

function productMark(name: string) {
  return PRODUCT_LOGO[name] ?? "/brand/logo-mark.jpg";
}
function markTile(src: string) {
  return /\/(github|openai|mcp)\.svg$/.test(src) ? { background: "#fff", padding: 3 } : undefined;
}

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
    message_sent: "Conversation message",
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


function appendHumanResult<T extends { chats: { id: string; messages: { id: string; role: "user" | "assistant"; content: string; at: string }[] }[] }>(ws: T, id: string, user: string, assistant: string): T {
  const generic = (title?: string) => !title || title === "Human Code" || title === "Intelligence" || title === "From EVE" || title === "New coding thread";
  const title = humanThreadTitle(user);
  const stamp = new Date().toISOString();
  return {
    ...ws,
    chats: ws.chats.map((chat) => chat.id === id ? { ...chat, title: generic((chat as { title?: string }).title) ? title : (chat as { title?: string }).title, messages: [...chat.messages, { id: crypto.randomUUID(), role: "user" as const, content: user, at: stamp }, { id: crypto.randomUUID(), role: "assistant" as const, content: assistant, at: stamp }] } : chat),
  };
}

function humanThreadTitle(text: string) {
  const rest = text.replace(/^\/\S+\s*/, "").replace(/\s+/g, " ").trim();
  const command = text.trim().match(/^\/(\S+)/)?.[1];
  if (command && !rest) {
    if (command === "test") return "Test check";
    if (command === "files") return "Workspace files";
    if (command === "diff") return "Local diff";
    if (command === "run") return "Build task";
    if (command === "fix") return "Fix task";
  }
  return (rest || text).replace(/\s+/g, " ").trim().slice(0, 48) || "Intelligence";
}

function shownChatTitle(chat: { title?: string; messages?: { role: string; content: string }[] }) {
  if (chat.title && chat.title !== "Human Code" && chat.title !== "Intelligence" && chat.title !== "New coding thread" && chat.title !== "From EVE") return chat.title;
  const first = chat.messages?.find((message) => message.role === "user")?.content || "";
  return first ? humanThreadTitle(first) : "Intelligence";
}

export function CommandApp() {
  const account = useCurrentUser();
  const loopback = typeof window !== "undefined" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
  const { ws, setWs, ready, syncNote, serverHeld, saveError, retrySave, clearStoredCopy } = useMindWorkspace(account?.id ?? null, account?.emailVerified ? account.primaryEmail : null);
  const router = useRouter();
  const [view, setViewState] = useState<View>("command");
  const applyingLocation = useRef(false);
  const locationHistory = useRef<"push" | "replace">("push");
  function loginReturnPath(resumeSpeak = false) {
    const params = new URLSearchParams();
    if (view !== "command") params.set("section", view);
    if (view === "chat" && activeId && !draftPrivate) params.set("chat", activeId);
    if (view === "settings" && settingsPane) params.set("pane", settingsPane);
    if (resumeSpeak) params.set("resume", "speak");
    return params.size ? "/?" + params.toString() : "/";
  }
  function setView(next: View) {
    setViewState(next);
  }
  const [imagineEdit, setImagineEdit] = useState<{ image: string; text: string; result?: ImageAttachment; returnFocus: HTMLElement | null } | null>(null);
  const [imagineEditError, setImagineEditError] = useState<string | null>(null);
  const [researchPending, setResearchPending] = useState(false);
  const researchFlight = useRef(false);
  const [libraryProjectId, setLibraryProjectId] = useState<string | null>(null);
  const [botDestinationId, setBotDestinationId] = useState("");
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const [cardFocus, setCardFocus] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!cardFocus) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(cardFocus.id);
      if (card) {
        const panel = card.closest("details");
        if (panel) panel.open = true;
      }
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: cardFocus.id.startsWith("message-") ? "center" : "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [cardFocus, view]);
  const [homeAction, setHomeAction] = useState<"ask" | "image" | "video" | "write" | "search">("ask");
  const [settingsPane, setSettingsPane] = useState<null | "general" | "connections" | "voice" | "pages" | "data" | "safety" | "keys" | "browser" | "personalization">(null);
  const [wipeAsk, setWipeAsk] = useState<string | null>(null);
  const [wipeStatus, setWipeStatus] = useState<string | null>(null);
  const [hiddenSettings, setHiddenSettings] = useState<string[]>([]);
  const [settingsMenu, setSettingsMenu] = useState<string | null>(null);
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
    const drawer = navDrawerRef.current;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if (drawer && phone) {
      const light = document.documentElement.dataset.theme === "light";
      const reduce = document.documentElement.dataset.adrianMotion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      drawer.style.setProperty("inset", "0 auto 0 0", "important");
      drawer.style.setProperty("width", "min(18.5rem, 84vw)", "important");
      drawer.style.setProperty("height", "100dvh", "important");
      drawer.style.setProperty("background", light ? "#f7f7f8" : "#161618", "important");
      drawer.style.setProperty("color", light ? "#18181b" : "#fafafa", "important");
      drawer.style.setProperty("border-radius", "0 22px 22px 0", "important");
      drawer.style.setProperty("box-shadow", "18px 0 48px rgba(0, 0, 0, 0.38)", "important");
      drawer.style.setProperty("z-index", "200", "important");
      if (!reduce) drawer.style.setProperty("animation", "adrian-drawer-in 240ms cubic-bezier(0.22, 1, 0.36, 1)", "important");
      const stage = document.querySelector(".main-stage");
      if (stage instanceof HTMLElement) stage.style.setProperty("visibility", "visible", "important");
    }
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
      drawer?.style.removeProperty("z-index");
      drawer?.style.removeProperty("inset");
      drawer?.style.removeProperty("width");
      drawer?.style.removeProperty("height");
      drawer?.style.removeProperty("background");
      drawer?.style.removeProperty("color");
      drawer?.style.removeProperty("border-radius");
      drawer?.style.removeProperty("box-shadow");
      drawer?.style.removeProperty("animation");
      const stage = document.querySelector(".main-stage");
      if (stage instanceof HTMLElement) stage.style.removeProperty("visibility");
      desktop.removeEventListener("change", closeAtDesktop);
      document.removeEventListener("keydown", onDrawerKeyDown, true);
    };
  }, [navOpen]);
  const openNav = (event: ReactMouseEvent<HTMLButtonElement>) => {
    navTriggerRef.current = event.currentTarget;
    closeMenus();
    setNavOpen(true);
  };
  const closeNavFromBackdrop = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) setNavOpen(false);
  };
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light" | "system">(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const stored = window.localStorage.getItem("amcos.theme.v1");
      return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
    } catch {
      return "dark";
    }
  });
  const [motionChoice, setMotionChoice] = useState<MotionChoice>(() => {
    if (typeof window === "undefined") return "smooth";
    try {
      return readMotionChoice(window.localStorage.getItem(MOTION_KEY), window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return "smooth";
    }
  });
  const [guide, setGuide] = useState<FirstStepsState>({ step: 0, dismissed: false });
  const [commandMode, setCommandMode] = useState<CommandMode>("ask");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [temporary, setTemporary] = useState(false);
  const draftOwner = account?.id ?? (loopback ? "dev-user" : null);
  const personalityKey = "amcos.default-style." + (draftOwner ?? "guest");
  const [stylePreference, setStylePreference] = useState<{ key: string; id: PersonalityId } | null>(null);
  const defaultPersonalityId = stylePreference?.key === personalityKey ? stylePreference.id : "assistant";
  useEffect(() => {
    try { setStylePreference({ key: personalityKey, id: resolvePersonalityId(localStorage.getItem(personalityKey)) }); }
    catch { setStylePreference(null); }
  }, [personalityKey]);
  function setDefaultPersonalityId(id: PersonalityId) {
    setStylePreference({ key: personalityKey, id });
    try { localStorage.setItem(personalityKey, id); } catch { /* Keep the session preference. */ }
  }
  const draftChat = view === "chat" && activeId ? ws.chats.find((item) => item.id === activeId) : null;
  const draftPrivate = draftChat?.temporary ?? temporary;
  const draftScope = JSON.stringify([draftOwner, draftChat?.id ?? "home", draftPrivate]);
  const persistDraft = Boolean(draftOwner) && !draftPrivate;
  const [draft, setDraft, setDraftInScope] = useComposerDraft(draftScope, "text", "", persistDraft);
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const turnAbort = useRef<AbortController | null>(null);
  const voiceScope = JSON.stringify([draftOwner, view, activeId]);
  const currentVoiceScope = useRef(voiceScope);
  currentVoiceScope.current = voiceScope;
  const auxiliaryHistory = useRef<{ scope: string; record: CallHistory } | null>(null);
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
  const reconnectTimer = useRef<number | undefined>(undefined);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [dictation, setDictation] = useState<DictationMachineState>(() => createDictationMachine(""));
  const dictationRef = useRef(dictation);
  dictationRef.current = dictation;
  const dictationRecRef = useRef<BrowserSpeechRec | null>(null);
  const serverDictationRef = useRef<DictationRecorder | null>(null);
  const dictationBufferRef = useRef("");
  const dictationBaseRef = useRef<string | null>(null);
  const userStoppedDictationRef = useRef(false);
  const [dictationElapsed, setDictationElapsed] = useState(0);
  const [dictationLevel, setDictationLevel] = useState(0);
  const [voiceOverlayOpen, setVoiceOverlayOpen] = useState(false);
  const [speakStageOpen, setSpeakStageOpen] = useState(false);
  const taskRecorder = useRef(createTaskRecorder());
  const taskStream = useRef<MediaStream | null>(null);
  const [taskRecording, setTaskRecording] = useState(false);
  const [taskSeconds, setTaskSeconds] = useState(0);
  const [speakCall, setSpeakCall] = useState({ heard: "", reply: "", error: "" });
  const speakStageOpenRef = useRef(false);
  useEffect(() => {
    speakStageOpenRef.current = speakStageOpen;
  }, [speakStageOpen]);
  useEffect(() => {
    if (!taskRecording) return;
    const id = window.setInterval(() => setTaskSeconds(Math.round(taskRecorder.current.elapsed() / 1000)), 500);
    return () => window.clearInterval(id);
  }, [taskRecording]);
  useEffect(() => {
    const end = (event: Event) => {
      if (!recordingEndsWithDocument(event)) return;
      taskStream.current?.getTracks().forEach((track) => track.stop());
      taskStream.current = null;
      void taskRecorder.current.stop();
      setTaskRecording(false);
      setTaskSeconds(0);
    };
    window.addEventListener("pagehide", end);
    window.addEventListener("beforeunload", end);
    return () => {
      window.removeEventListener("pagehide", end);
      window.removeEventListener("beforeunload", end);
    };
  }, []);
  function keepTaskRecording(stream: MediaStream) {
    taskStream.current = stream;
    taskRecorder.current.start(stream);
    setTaskRecording(true);
    setTaskSeconds(0);
  }
  async function stopTaskRecording() {
    const blob = await taskRecorder.current.stop();
    taskStream.current?.getTracks().forEach((track) => track.stop());
    taskStream.current = null;
    setTaskRecording(false);
    setTaskSeconds(0);
    setNotice(blob ? "Recording stopped in this tab. It cannot continue after the browser is closed." : "Recording was already stopped.");
  }
  const [surfaceMenu, setSurfaceMenu] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const chatSettingsTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (view !== "chat") setChatSettingsOpen(false);
  }, [view]);
  useEffect(() => {
    if (!chatSettingsOpen || view !== "chat") return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setChatSettingsOpen(false);
      chatSettingsTrigger.current?.focus();
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [view, chatSettingsOpen]);
  const [surfaceAnchor, setSurfaceAnchor] = useState<DOMRect | null>(null);
  const controlsTrigger = useRef<HTMLButtonElement>(null);
  const [navMoreOpen, setNavMoreOpen] = useState(false);
  const [navMoreHold, setNavMoreHold] = useState(false);
  const [navMoreAnchor, setNavMoreAnchor] = useState<DOMRect | null>(null);
  const [modelRowsOpen, setModelRowsOpen] = useState(false);
  const [alertAnchor, setAlertAnchor] = useState<DOMRect | null>(null);
  const [accountAnchor, setAccountAnchor] = useState<DOMRect | null>(null);
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
  const desktopActedRef = useRef(new Set<string>());
  const closeVoiceOverlayRef = useRef<() => void>(() => undefined);
  const cancelDictationRef = useRef<(announce?: boolean) => void>(() => undefined);
  const turnGen = useRef(0);
  const turnInFlight = useRef(false);
  const deliverStoredUser = useRef(false);
  type QueuedChatMessage = CuedMessage & {
    chatId: string;
    ownerId: string;
    paused?: boolean;
    dispatch: (chat: Chat, workspace: Workspace) => Promise<boolean>;
  };
  const turnOwner = useRef(draftOwner);
  turnOwner.current = draftOwner;
  const [turnChat, setTurnChat] = useState<{ ownerId: string | null; chatId: string } | null>(null);
  const cueRef = useRef<QueuedChatMessage[]>([]);
  const [cued, setCued] = useState<QueuedChatMessage[]>([]);
  useEffect(() => {
    return () => {
      turnGen.current++;
      turnAbort.current?.abort();
      turnAbort.current = null;
      turnInFlight.current = false;
      cueRef.current = [];
      setCued([]);
      setPending(null);
      setBusy(false);
      setLiveText("");
      setTurnChat(null);
      setFailure(null);
    };
  }, [draftOwner]);
  const imagineInFlight = useRef(false);
  const videoInFlight = useRef(false);
  const mcpInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const warn = () => setNotice("This draft is available in this tab only. Browser storage could not save the latest change for reload.");
    window.addEventListener("adrian-draft-storage-full", warn);
    return () => window.removeEventListener("adrian-draft-storage-full", warn);
  }, []);
  const [failure, setFailure] = useState<{ message: string; auditId: string; retry: (() => void) | null; kind: HonestFailureKind | null; action?: RouteFailureAction; chatId?: string } | null>(null);
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
  const [selectionLoaded, setSelectionLoaded] = useState(false);
  const [providerChoice, setProviderChoice] = useState("grok");
  const [customAiProviders, setCustomAiProviders] = useState<PublicAiProvider[]>([]);
  const [modelTier, setModelTier] = useState<ModelTier>("Auto");
  const [grokModel, setGrokModel] = useState<string | null>(null);
  const [logicRoute, setLogicRoute] = useState<LogicRouteId | null>(null);
  const [logicRoutes, setLogicRoutes] = useState<LogicRoutePublic[]>([]);
  const [composerEffort, setComposerEffort] = useState<ComposerModeId>("auto");
  const [consultModel, setConsultModel] = useState("");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("A");
  const [routingPanel, setRoutingPanel] = useState<LogicRouteId[]>([]);
  const ratingOwner = account?.id ? "account:" + account.id : "device:guest";
  const [ratings, setRatings] = useState<ResponseRating[]>([]);
  const [lastResolvedTier, setLastResolvedTier] = useState<ConcreteModelTier | null>(null);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [failoverPolicy, setFailoverPolicy] = useState<"none" | "grok">("none");
 const [researchCitations, setResearchCitations] = useState<{ title: string; url: string }[]>([]);
  const [researchReportQuestion, setResearchReportQuestion] = useState("");
  type ResearchReport = { id: string; question: string; summary: string; citations: { title: string; url: string }[]; at: string; steps?: { query: string; ok: boolean; count: number }[] };
  const [researchHistory, setResearchHistory] = useState<ResearchReport[]>([]);
  const [researchSteps, setResearchSteps] = useState<ResearchReport["steps"]>([]);
  const [researchOwner, setResearchOwner] = useState<string | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, string>>({});
  const [searchProvider, setSearchProvider] = useState("Checking search route");

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
  const [projectChoice, setProjectChoice] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryProject, setMemoryProject] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryTab, setMemoryTab] = useState<"mine" | "project" | "chat" | "transfer">("mine");
  const memoryScope = memoryTab === "project" ? "project" : "global";
  const [researchText, setResearchText] = useState("");
  const [researchBand, setResearchBand] = useState<"search" | "saved" | "files">("search");
  const [researchNote, setResearchNote] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [chatProjectId, setChatProjectId] = useState<string | null>(null);
  const [imageAllowance, setImageAllowance] = useState<{ dailyCap: number; remaining: number; unconfirmed: number; resetAt: string } | null>(null);
  const [allowanceError, setAllowanceError] = useState("");
  useEffect(() => {
    if (view !== "activity") return;
    const controller = new AbortController();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    const token = getBearerToken();
    setImageAllowance(null);
    setAllowanceError("");
    void fetch(prefix + "/api/mind/media/generate", { credentials: "include", cache: "no-store", signal: controller.signal,
      headers: token ? { authorization: "Bearer " + token } : {},
    }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "Image allowance unavailable.");
      if (!controller.signal.aborted) setImageAllowance(body);
    }).catch((error) => {
      if (!controller.signal.aborted) setAllowanceError(error instanceof Error ? error.message : "Image allowance unavailable.");
    });
    return () => controller.abort();
  }, [view, draftOwner]);
  const [activityQuery, setActivityQuery] = useState("");
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const [shareProjectId, setShareProjectId] = useState<string | null>(null);
  const [shareBotId, setShareBotId] = useState<string | null>(null);
  const [libraryBand, setLibraryBand] = useState<"files" | "preview" | "media">("files");
  const [showArchived, setShowArchived] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [noteMenu, setNoteMenu] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [armMemory, setArmMemory] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectAbout, setProjectAbout] = useState("");
  const [projectOpen, setProjectOpen] = useState(false);
  const [includeTemporary, setIncludeTemporary] = useState(false);
  const [importPreview, setImportPreview] = useState<{ workspace: Workspace; name: string } | null>(null);
  const messagePreview = importPreview ? archiveMessagePreview(ws, importPreview.workspace) : null;
  const importCounts = importPreview ? ([
    ["chats", "Chats"], ["memories", "Notes"], ["projects", "Projects"], ["files", "Files"], ["agents", "Bots"], ["runs", "Runs"], ["schedules", "Schedules"],
  ] as const).map(([key, label]) => {
    const current = new Set(ws[key].map((item) => item.id));
    const incoming = importPreview.workspace[key];
    return { label, current: current.size, incoming: incoming.length, overlap: incoming.filter((item) => current.has(item.id)).length };
  }) : [];
  const [importChecking, setImportChecking] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [staged, setStaged, setStagedInScope] = useComposerDraft<Staged | null>(draftScope, "file", null, persistDraft);
  const [pendingImages, setPendingImages, setImagesInScope] = useComposerDraft<ImageAttachment[]>(draftScope, "images", EMPTY_DRAFT_IMAGES, persistDraft);
  const [excerpt, setExcerpt] = useState<{ scope: string; file: Staged; limit: number } | null>(null);
  const excerptRef = useRef<HTMLTextAreaElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const greet = typeof document !== "undefined" && document.querySelector("[data-greeting]")?.getAttribute("data-greeting") || greeting(now ?? new Date());
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (ws.halted) {
      if (cueRef.current.some((entry) => !entry.paused)) rememberCue(cueRef.current.map((entry) => ({ ...entry, paused: true })));
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
    if (statusSignedIn !== true) return;
    let canceled = false;
    void fetch("/api/mind/media/cloud/status", { credentials: "include" })
      .then((response) => response.json())
      .then((body: { sources?: { state?: string }[] }) => {
        if (canceled) return;
        setDriveConnected(Boolean(body.sources?.some((row) => row.state === "connected")));
      })
      .catch(() => {
        if (!canceled) setDriveConnected(false);
      });
    return () => {
      canceled = true;
    };
  }, [statusSignedIn]);

  useEffect(() => {
    // Single store: hydrate from localStorage once; every badge reads the same snapshot.
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    hydrateVoiceModeStore(storage);
    const choice = readStoredVoiceChoice(storage);
    voiceChoiceRef.current = choice;
    setVoiceChoice(choice);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const known = Object.keys(TITLES);
    const applyLocation = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "agent" && params.get("agentId")) return;
      applyingLocation.current = true;
      locationHistory.current = "replace";
      const resolved = resolveShare(window.location.search, wsRef.current, known);
      setViewState(resolved.view as View);
      if (resolved.view === "settings") {
        const pane = params.get("pane");
        if (pane === "connections" || pane === "general" || pane === "keys" || pane === "voice" || pane === "data" || pane === "safety" || pane === "browser" || pane === "pages" || pane === "personalization") setSettingsPane(pane);
      }
      if (params.get("resume") === "speak") {
        setSpeakStageOpen(true);
        const url = new URL(window.location.href);
        url.searchParams.delete("resume");
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
      setActiveId(resolved.chatId);
      setShareProjectId(resolved.projectId);
      setShareBotId(resolved.botId);
      if (resolved.fileId) {
        setOpenFileId(resolved.fileId);
        setLibraryBand("preview");
        setLibraryProjectId(null);
      } else {
        setOpenFileId(null);
        if (resolved.view === "files") setLibraryBand("files");
      }
      if (resolved.focusId) setCardFocus({ id: resolved.focusId });
      if (resolved.missing.length) setNotice(shareMissLabel(resolved.missing));
      else if (resolved.botArchived) setNotice("That bot is archived on this device. Its history was kept.");
      requestAnimationFrame(() => {
        applyingLocation.current = false;
      });
    };
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [ready]);

  useEffect(() => {
    if (!ready || applyingLocation.current || typeof window === "undefined") return;
    const nextWrite = shareWriteForView(view, {
      chat: activeId,
      project: shareProjectId,
      file: openFileId,
      bot: shareBotId,
    });
    if (shareWriteDropsMissing(window.location.search, nextWrite, wsRef.current, Object.keys(TITLES))) {
      locationHistory.current = "push";
      return;
    }
    const search = writeShareSearch(window.location.search, nextWrite, Object.keys(TITLES));
    if (sameShareLocation(window.location.pathname, window.location.hash, window.location.search, search)) {
      locationHistory.current = "push";
      return;
    }
    const next = window.location.pathname + search + window.location.hash;
    const mode = locationHistory.current;
    locationHistory.current = "push";
    if (mode === "replace") router.history.replace(next);
    else router.history.push(next);
  }, [ready, view, activeId, shareProjectId, openFileId, shareBotId, router]);

  const personaHandoffDone = useRef(false);
  useEffect(() => {
    if (!ready || personaHandoffDone.current || typeof window === "undefined") return;
    const selection = readPersonaSelection(window.localStorage);
    const params = new URLSearchParams(window.location.search);
    const agentId = selection?.agentId || params.get("agentId");
    if (!agentId || (params.get("mode") !== "agent" && !selection)) return;
    personaHandoffDone.current = true;
    const stored = loadWorkspace(window.localStorage);
    const agent = stored.agents.find((item) => item.id === agentId && !item.archived) ?? ws.agents.find((item) => item.id === agentId && !item.archived);
    clearPersonaSelection(window.localStorage);
    const url = new URL(window.location.href);
    url.searchParams.delete("mode");
    url.searchParams.delete("agentId");
    router.history.replace(url.pathname + url.search + url.hash);
    if (!agent) {
      setNotice("That persona was not found on this device. Nothing was opened.");
      return;
    }
    const base = ws.agents.some((item) => item.id === agent.id) ? ws : stored;
    const opened = openBotChat(base, agent.id);
    if (!opened) return;
    if (opened.ws !== ws) setWs(() => opened.ws);
    setActiveId(opened.chat.id);
    setView("chat");
    setNotice(`${agent.name} is open in Chat.`);
  }, [ready, ws, setWs]);

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

  const consultModules = useMemo<ConsultModule[]>(() => [
    ...builtinModules({
      grokConfigured,
      providers: liveProviders,
      localRunner: typeof localStorage !== "undefined" && Boolean(localStorage.getItem("amcos.ollama.base")?.trim()),
    }),
    ...customModules(customAiProviders),
  ], [grokConfigured, liveProviders, customAiProviders]);

  useEffect(() => {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const next = loadConsultModel(storage, consultModules);
    setConsultModel((current) => (consultModules.some((item) => item.id === current) ? current : next));
  }, [consultModules]);

  function chooseConsultModel(id: string) {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    saveConsultModel(storage, id);
    setConsultModel(id);
  }

  function chooseModelTier(tier: ModelTier) {
    selectProviderInChat("grok", tier);
    setGrokModel(null);
    setModelTier(tier);
    const effort = effortForModelTier(tier);
    if (effort) {
      saveComposerEffort(typeof localStorage === "undefined" ? null : localStorage, effort);
      setComposerEffort(effort);
    }
  }

  function selectProviderInChat(id: string, tier?: ModelTier) {
    if (id !== providerChoice) clearFailure();
    if (composerEffort === "orchestrator" || composerEffort === "build") chooseComposerEffort("auto");
    chooseRoutingMode("A");
    if (active?.agentId || active?.botProvider || active?.botTier) {
      // This conversation follows the explicit selection. Other bot threads keep their defaults.
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((chat) => chat.id === active.id ? { ...chat, botProvider: id, botTier: tier ?? chat.botTier ?? modelTier } : chat),
      }));
    } else {
      setLogicRoute(isLogicRouteId(id) ? id : null);
      setProviderChoice(id);
    }
    setView("chat");
    setControlsOpen(false);
    setNavOpen(false);
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

  useEffect(() => {
    setRatings(readRatings(localStorage, ratingOwner));
  }, [ratingOwner]);

  function rateReply(messageId: string, score: 1 | 2 | 3 | 4 | 5, model: string | null) {
    const reply = active?.messages.find((item) => item.id === messageId);
    if (!reply || active?.temporary) return;
    try {
      const next = saveRating(localStorage, {
        messageId, score, model, provider: reply.provider, mode: reply.routingMode ?? null, at: new Date().toISOString(),
      }, ratingOwner);
      setRatings(next);
    } catch {
      setNotice("The browser could not save this rating.");
    }
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
      window.clearTimeout(reconnectTimer.current);
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
    const claimOneVoice = () => {
      window.speechSynthesis?.cancel();
      voiceSession.current?.interruptPlayback();
      interruptMessageSpeak({
        sharedAudio: sharedAudioOutput,
        abortSpeak: speakAbortRef.current,
        speechSynthesis: window.speechSynthesis,
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseVoice();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", releaseVoice);
    window.addEventListener("adrian-one-voice", claimOneVoice);
    const liftKeyboard = () => {
      const viewport = window.visualViewport;
      const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      document.documentElement.style.setProperty("--kb", `${Math.round(inset)}px`);
    };
    liftKeyboard();
    window.visualViewport?.addEventListener("resize", liftKeyboard);
    window.visualViewport?.addEventListener("scroll", liftKeyboard);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", releaseVoice);
      window.removeEventListener("adrian-one-voice", claimOneVoice);
      window.visualViewport?.removeEventListener("resize", liftKeyboard);
      window.visualViewport?.removeEventListener("scroll", liftKeyboard);
      releaseVoice();
    };
  }, []);

  const [reaBusy, setReaBusy] = useState(false);
  const [reaReport, setReaReport] = useState<string | null>(null);
  const [notion, setNotion] = useState<{ state: "unconfigured" | "disconnected" | "connected"; detail: string } | null>(null);
  const [notionQuery, setNotionQuery] = useState("");
  const notionEpoch = useRef(0);
  const notionSearchRequest = useRef(0);
  const searchIssue = notionSearchIssue(ws.audit);
  const [notionPreview, setNotionPreview] = useState<{ owner: string | null; chatId: string; text: string } | null>(null);
  useEffect(() => {
    notionEpoch.current++;
    setNotionPreview(null);
    setNotionQuery(""); setNotionPages([]); setNotionNote(null);
  }, [draftOwner]);
  useEffect(() => { setNotionPreview(null); }, [activeId, view]);
  const [notionPages, setNotionPages] = useState<{ id: string; title: string; url: string }[]>([]);
  const [notionNote, setNotionNote] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<SavedMcpServer[]>([]);
  const discovered = discoveredCapabilities({
    models: customAiProviders,
    mcp: mcpServers,
    services: [
      { id: "notion", label: "Notion", connected: notion?.state === "connected" },
      { id: "drive", label: "Google Drive", connected: driveConnected },
      { id: "social", label: "Adrian Social", connected: false, opensWorkspace: true },
      { id: "gpt-wrapper", label: "GPT wrapper", connected: false, opensWorkspace: true },
    ],
  });
  const catalogModels = discovered.filter((item) => item.usable).map((item) => ({ id: item.id, label: item.label }));
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
  const [skillInventory, setSkillInventory] = useState<string[]>([]);
  const [skillInventoryStatus, setSkillInventoryStatus] = useState("");
  const [skillRefreshNonce, setSkillRefreshNonce] = useState(0);
  const [skillBand, setSkillBand] = useState<"device" | "installed" | "missing">("device");
  const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
  const [skillNoteQuery, setSkillNoteQuery] = useState("");
  const [skillResult, setSkillResult] = useState<{ id: string; text: string } | null>(null);
  const [skillStorageError, setSkillStorageError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inspectFileRef = useRef<HTMLInputElement>(null);
  const clearedStop = useRef(false);
  const counts = requirementCounts();
  const active = ws.chats.find((chat) => chat.id === activeId) ?? null;
  const followupPrivate = active?.temporary ?? temporary;

  const providerOptions = [
    ...providerChoicesWithKeys(grokConfigured, null, liveProviders),
    ...consultModules.filter((item) => item.id === "nemotron" || item.id === "ollama")
      .map((item) => ({ id: item.id, label: item.label, enabled: item.connected, reason: "Sending checks runner availability." })),
    ...discovered.map((item) => ({ id: item.id, label: item.label, enabled: item.usable, reason: item.reason })),
  ];
  const effectiveRoute = routeForBotChat(active, { provider: providerChoice, modelTier });
  const effectiveProvider = effectiveRoute.fromBot ? effectiveRoute.provider : logicRoute ?? effectiveRoute.provider;
  const researchFreeOnly = effectiveProvider === "openrouter" || effectiveProvider === "nemotron" || /(?:%3A|:)free$/i.test(effectiveProvider)
    || /:free$/i.test(providerModels[effectiveProvider] || "");
  const currentFreeOnly = useRef(researchFreeOnly);
  currentFreeOnly.current = researchFreeOnly;
  useEffect(() => {
    if (!researchFreeOnly) return;
    if (listenMintAbortRef.current || voiceSession.current) stopVoiceSession();
    if (speakAbortRef.current) interruptSpeakPlayback();
  }, [researchFreeOnly]);
  const controlsModelLabel = effectiveProvider === "grok" ? grokModel ?? effectiveRoute.modelTier
    : providerOptions.find((option) => option.id === effectiveProvider)?.label
      ?? logicRoutes.find((option) => option.id === effectiveProvider)?.label ?? "Selected module unavailable";
  const storedBytes = useMemo(() => new Blob([JSON.stringify(ws)]).size, [ws]);

  useEffect(() => {
    if (!focusAuditId || view !== "activity") return;
    if (!ws.audit.some((item) => item.id === focusAuditId)) { setNotice("This event is no longer in the retained activity history."); return; }
    const node = document.getElementById(`audit-${focusAuditId}`);
    node?.scrollIntoView({ block: "nearest", behavior: document.documentElement.dataset.adrianMotion === "reduce" ? "instant" : "smooth" });
  }, [focusAuditId, view, ws.audit]);

  useEffect(() => {
    if (navMoreOpen) {
      setNavMoreHold(true);
      return;
    }
    const id = window.setTimeout(() => setNavMoreHold(false), 150);
    return () => window.clearTimeout(id);
  }, [navMoreOpen]);
  useEffect(() => {
    if (view !== "skills") return;
    const controller = new AbortController();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    setSkillInventoryStatus("Reading skill directory…");
    const bearer = getBearerToken();
    void fetch(prefix + "/api/mind/skills", { credentials: "include", cache: "no-store", signal: controller.signal,
      headers: bearer ? { authorization: "Bearer " + bearer } : {},
    }).then(async (response) => {
      const body = await response.json() as { skills?: string[]; error?: string };
      if (!response.ok || !Array.isArray(body.skills)) throw new Error(body.error || "Could not read skill directory.");
      if (controller.signal.aborted) return;
      setSkillInventory(body.skills);
      setSkillInventoryStatus(body.skills.length + " instruction sets found on the server.");
    }).catch((error) => {
      if (!controller.signal.aborted) setSkillInventoryStatus(error instanceof Error ? error.message : "Skill refresh failed.");
    });
    return () => controller.abort();
  }, [view, skillRefreshNonce]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || (view !== "chat" && view !== "command")) return;
    const root = document.documentElement;
    function resetViewport() {
      root.style.removeProperty("--mind-visible-height");
      root.style.removeProperty("--mind-visible-top");
    }
    function fitViewport() {
      if (!viewport || viewport.scale !== 1) {
        resetViewport();
        return;
      }
      root.style.setProperty("--mind-visible-height", `${Math.round(viewport.height)}px`);
      root.style.setProperty("--mind-visible-top", `${Math.max(0, Math.round(viewport.offsetTop))}px`);
    }
    fitViewport();
    viewport.addEventListener("resize", fitViewport);
    viewport.addEventListener("scroll", fitViewport);
    return () => {
      viewport.removeEventListener("resize", fitViewport);
      viewport.removeEventListener("scroll", fitViewport);
      resetViewport();
    };
  }, [view]);

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
        setSearchProvider(status.searchProvider);
        setProviderModels(status.providerModels);
        if (status.providers && typeof status.providers === "object") setLiveProviders(status.providers);
        setGrok(status.grok === "configured" ? "Configured" : status.grok === "down" ? "Refused" : "Setup required");
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
        setGrok("Status unavailable");
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
      setGrokModel(stored.grokModel ?? null);
      setLogicRoute(stored.logicRoute);
      const fail = localStorage.getItem("amcos.failover.v1");
      if (fail === "grok" || fail === "none") setFailoverPolicy(fail);
      setRoutingMode(readRoutingMode(localStorage));
      setRoutingPanel(readRoutingPanel(localStorage));

    } catch {
      /* a private browser can refuse storage */
    } finally {
      setSelectionLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!selectionLoaded) return;
    try {
      writeSelection(localStorage, { provider: providerChoice, modelTier, logicRoute, grokModel: grokModel ?? undefined });
      localStorage.setItem("amcos.failover.v1", failoverPolicy);
    } catch {
      /* a private browser can refuse storage */
    }
  }, [selectionLoaded, providerChoice, modelTier, logicRoute, grokModel, failoverPolicy]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const step = () => {
      const current = wsRef.current;
      if (current.halted) return;
      const now = new Date().toISOString();
      const due = current.schedules.some((job) => job.enabled && job.nextRunAt <= now);
      const queued = current.runs.some((run) => run.state === "queued" || run.state === "running");
      if (!due && !queued) return;
      for (const run of current.runs) {
        // Scheduled occurrences execute their declared agent tools. Their titles must never become PC commands.
        if (run.id.startsWith("scheduled:") || run.parentId?.startsWith("scheduled:")) continue;
        if (run.state !== "queued" || desktopActedRef.current.has(run.id) || !spokenPcCommand(run.goal)) continue;
        desktopActedRef.current.add(run.id);
        void fetch("/api/mind/pc/status", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: run.goal, destination: "current-device" }) });
      }
      const next = tickFleet(runDueSchedules(current, now), { now, workerId: "browser-worker" });
      setWs(next);
    };
    const id = window.setInterval(step, 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        closeMenus("palette");
        setPaletteOpen(true);
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        if (speakStageOpenRef.current) {
          event.preventDefault();
          setSpeakStageOpen(false);
          if (!overlayOpenRef.current) void listenRef.current({ mode: "stop" });
          return;
        }
        if (overlayOpenRef.current) {
          event.preventDefault();
          closeVoiceOverlayRef.current();
          return;
        }
        closeMenus();
        setNavOpen(false);
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
    setResearchOwner(draftOwner);
    setResearchHistory([]);
    setResearchCitations([]);
    setResearchText("");
    setResearchNote(null);
    setResearchReportQuestion("");
    setResearchSteps([]);
    if (!draftOwner) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`amcos.research.v2.${draftOwner}`) || "[]") as ResearchReport[];
      if (Array.isArray(stored)) setResearchHistory(stored.slice(0, 8));
    } catch { /* Browser storage is optional. */ }
  }, [draftOwner]);

  useEffect(() => {
    const device = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && device.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    if (theme === "system") device.addEventListener("change", apply);
    try {
      localStorage.setItem("amcos.theme.v1", theme);
    } catch {
      /* a private browser can refuse storage */
    }
    return () => device.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    applyMotionChoice(document, readMotionChoice(motionChoice, window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  }, [motionChoice]);

  useEffect(() => {
    try {
      setGuide(readFirstSteps(localStorage.getItem(FIRST_STEPS_KEY)));
    } catch {
      /* a private browser can refuse storage */
    }
  }, []);

  const persistGuide = (next: FirstStepsState) => {
    setGuide(next);
    try {
      localStorage.setItem(FIRST_STEPS_KEY, JSON.stringify(next));
    } catch {
      /* a private browser can refuse storage */
    }
  };

  const chooseMotion = (choice: MotionChoice) => {
    setMotionChoice(choice);
    try {
      localStorage.setItem(MOTION_KEY, choice);
    } catch {
      /* a private browser can refuse storage */
    }
    window.dispatchEvent(new Event("amcos-motion"));
  };

  const openGuide = (id: FirstStepId) => {
    if (id === "ask") {
      setView("command");
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("[data-testid='home-command']")?.focus());
      return;
    }
    if (id === "speak") {
      openSpeakStage();
      return;
    }
    if (id === "settings") {
      setSettingsPane(null);
      setView("settings");
      setNavOpen(false);
      return;
    }
    window.location.assign("/login?next=" + encodeURIComponent(loginReturnPath()));
  };

  const hits = useMemo(
    () =>
      paletteHits({
        query,
        projects: ws.projects,
        chats: ws.chats.map((chat) => ({ ...chat, title: shownChatTitle(chat), humanCode: isIntelligenceThread(chat.customPersonality) })),
        memories: ws.memories,
        files: ws.files,
        agents: ws.agents,
        runs: ws.runs,
      }),
    [query, ws],
  );

  type ChromeMenu = "palette" | "surface" | "bell" | "account" | "controls" | "nav";

  function closeMenus(keep?: ChromeMenu) {
    if (keep !== "palette") setPaletteOpen(false);
    if (keep !== "surface") setSurfaceMenu(false);
    if (keep !== "bell") setBellOpen(false);
    if (keep !== "account") setAccountOpen(false);
    if (keep !== "controls") setControlsOpen(false);
    if (keep !== "nav") setNavMoreOpen(false);
    document.querySelectorAll("details.composer-more[open]").forEach((node) => node.removeAttribute("open"));
    setContextOpen(false);
    setToolsOpen(false);
    setNavOpen(false);
  }

  function openPaletteHit(hit: (typeof hits)[number]) {
    setFocusRunId(hit.view === "runs" && hit.ref ? hit.ref : null);
    if (hit.ref && (hit.view === "agents" || hit.view === "projects" || hit.view === "runs")) {
      const kind = hit.view === "agents" ? "bot" : hit.view === "projects" ? "project" : "run";
      setCardFocus({ id: `${kind}-${hit.ref}` });
    } else setCardFocus(null);
    if ((hit.view === "chat" || hit.view === "code") && hit.ref) {
      setActiveId(hit.ref);
      if (hit.messageId) setCardFocus({ id: "message-" + hit.messageId });
    }
    if (hit.view === "memory" && hit.ref) {
      const note = ws.memories.find((item) => item.id === hit.ref);
      setMemoryTab(note?.scope === "project" ? "project" : note?.scope === "chat" ? "chat" : "mine");
      setMemoryProject(note?.projectId || "");
      setMemoryQuery("");
      setCardFocus({ id: "note-" + hit.ref });
    }
    if (hit.view === "projects" && hit.ref) setShareProjectId(hit.ref);
    if (hit.view === "agents" && hit.ref) setShareBotId(hit.ref);
    if (hit.view === "files" && hit.ref) {
      setLibraryProjectId(null);
      setOpenFileId(hit.ref);
      setLibraryBand("preview");
    }
    if (hit.view === "speak") openSpeakStage();
    else if (hit.view === "social" || hit.view === "gpt-wrapper") window.location.assign("/" + hit.view);
    else setView(hit.view);
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

  function deleteSavedChats(ids: string[], label: string) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    requestProtected("delete", `delete-chats:${unique.slice().sort().join(",")}`, label, "The transcripts are removed from this browser. Saved notes stay until you delete them.", "Approve delete", () => {
      setWs((prev) => pushAudit(removeConversations(prev, unique), "delete_chat", unique[0] ?? "chat", unique.length === 1 ? "approved" : `${unique.length} removed`));
      setActiveId((current) => (current && unique.includes(current) ? null : current));
      setNavOpen(false);
    });
  }

  function runConversationAction(action: ConversationAction, ids: string[], extra?: { projectId?: string | null; title?: string }) {
    const targets = wsRef.current.chats.filter((chat) => ids.includes(chat.id));
    if (targets.length === 0) return;
    if (action === "delete") {
      deleteSavedChats(ids, ids.length === 1 ? `Delete “${shownChatTitle(targets[0]!)}”` : `Delete ${targets.length} conversations`);
      return;
    }
    if (action === "copy") {
      const text = targets.map((chat) => `${window.location.origin}${window.location.pathname}${conversationSharePath(chat.id, Object.keys(TITLES))}`).join("\n");
      if (!navigator.clipboard) { setNotice(text); return; }
      void navigator.clipboard.writeText(text).then(
        () => setNotice(targets.length === 1 ? "Link copied. It opens this conversation on a device that already has it." : "Links copied. They open on devices that already have these conversations."),
        () => setNotice(text),
      );
      return;
    }
    if (action === "files") {
      setLibraryProjectId(targets.find((chat) => chat.projectId)?.projectId ?? null);
      setLibraryBand("files");
      setView("files");
      setNavOpen(false);
      setNotice(targets.some((chat) => chat.projectId) ? "Library is showing files for that project." : "This conversation has no project files. Library shows every text copy on this device.");
      return;
    }
    if (action === "scheduled") {
      let next = wsRef.current;
      let created = 0;
      for (const chat of targets) {
        const result = scheduleConversation(next, shownChatTitle(chat), chat.id);
        if (result.error) { setError(result.error); return; }
        if (result.created) {
          next = pushAudit(result.ws, "schedule_chat", chat.id, "saved off");
          created++;
        }
      }
      setWs(next);
      setView("scheduled");
      setNavOpen(false);
      setNotice(created ? `${created} schedule(s) saved and off. Choose an agent and turn on when ready.` : "Schedules already saved.");
      return;
    }
    if (action === "pin") {
      const allPinned = targets.every((chat) => wsRef.current.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id));
      const before = wsRef.current;
      const after = targets.reduce((next, chat) => {
        const isPinned = next.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id);
        return allPinned || !isPinned ? togglePin(next, "chat", chat.id) : next;
      }, before);
      setWs(after);
      const added = targets.filter((chat) => !before.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id) && after.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id));
      const skipped = targets.filter((chat) => !after.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id));
      const addedText = added.length ? `Pinned ${added.map(shownChatTitle).join(", ")}. ` : "";
      setNotice(allPinned ? "Unpinned." : skipped.length ? `${addedText}Pin limit reached. Skipped ${skipped.map(shownChatTitle).join(", ")}.` : addedText.trim());
      return;
    }
    if (action === "favorite") {
      const favorite = targets.some((chat) => chat.favorite !== true);
      setWs((prev) => pushAudit(applyFavorite(prev, ids, favorite), "favorite_chat", ids[0] ?? "chat", favorite ? "on" : "off"));
      return;
    }
    if (action === "archive") {
      const archived = targets.some((chat) => chat.archived !== true);
      setWs((prev) => pushAudit(applyArchive(prev, ids, archived), "archive_chat", ids[0] ?? "chat", archived ? "archived" : "restored"));
      if (archived && activeId && ids.includes(activeId)) setActiveId(null);
      return;
    }
    if (action === "project") {
      setWs((prev) => pushAudit(applyProject(prev, ids, extra?.projectId ?? null), "assign_project", ids[0] ?? "chat", extra?.projectId || "cleared"));
      setNotice(extra?.projectId ? "Conversation and its chat notes moved. Existing project files stay in their original project." : "Removed from the project.");
      return;
    }
    if (action === "rename") {
      const next = applyRename(wsRef.current, ids, extra?.title || "");
      if (!next) {
        setError("Name the conversation.");
        return;
      }
      setWs(pushAudit(next, "rename_chat", ids[0] ?? "chat", extra?.title?.trim() || "renamed"));
      return;
    }
    const opened = quoteIntoNewChat(wsRef.current, targets[0]!);
    setWs(pushAudit(opened.ws, "quote_chat", targets[0]!.id, "new task"));
    setActiveId(opened.chatId);
    setView("chat");
    setNavOpen(false);
  }

  function rememberHiddenSettings(next: string[]) {
    setHiddenSettings(next);
    localStorage.setItem(HIDDEN_SETTINGS_SECTIONS_KEY, JSON.stringify(next));
  }

  useEffect(() => {
    setHiddenSettings(readHiddenSections(localStorage.getItem(HIDDEN_SETTINGS_SECTIONS_KEY)));
  }, []);

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
    if (turnOwner.current !== draftOwner || !wsRef.current.chats.some((item) => item.id === chat.id)) return;
    const at = new Date().toISOString();
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: text, at };
    const assistant = { id: crypto.randomUUID(), role: "assistant" as const, content: reply, at, model: "local-tool" };
    if (meta) void recordAgentExecution({ data: { id: assistant.id, tool: meta.tool, action: meta.action, ok: meta.ok, detail: meta.ok ? "Completed" : "Failed" } }).catch(() => undefined);
    setWs((prev) => {
      const current = prev.chats.find((item) => item.id === chat.id);
      if (!current || turnOwner.current !== draftOwner) return prev;
      const base = mutate ? mutate(prev) : prev;
      const title = !current.messages.length && current.title === chat.title ? text.replace(/\s+/g, " ").slice(0, 48) : current.title;
      const chats = base.chats.map((item) => item.id === chat.id
        ? { ...current, title, messages: [...current.messages, userMsg, assistant] }
        : item);
      return pushAudit({ ...base, chats }, "tool_turn", meta?.tool ?? chat.id, meta ? `${meta.action} ${meta.ok ? "completed" : "failed"}` : "no model");
    });
  }

  function agentTools(source: Workspace, chat: Chat): AgentTool[] {
    const scoped = workspaceForChat(source, chat);
    const local = (id: "list_projects" | "list_chats" | "search_notes"): AgentTool => ({
      id,
      confirm: false,
      available: true,
      unavailableReason: "",
      run: (text) => {
        const result = runLocalPlan(scoped, [{ id, tool: id, query: text }], { autonomy: "automatic", halted: source.halted, tokens: {} });
        return { ok: result.ok, text: result.lines.join("\n") || "No result." };
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
        run: (text) => runRequestedSkill(scoped, text, enabledSkills),
      },
      {
        id: "save_chat_skill",
        confirm: false,
        available: true,
        unavailableReason: "",
        run: (text) => {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/mind/skills", false);
            xhr.setRequestHeader("content-type", "application/json");
            xhr.send(JSON.stringify({ title: "from chat", body: text }));
            const proposal = JSON.parse(xhr.responseText) as { ok?: boolean; note?: string; markdown?: string; error?: string };
            if (!proposal.ok || !proposal.markdown) {
              return { ok: false, text: proposal.error || "Could not prepare a skill proposal." };
            }
            return { ok: true, text: `${proposal.note ?? "Review this skill proposal"}\n\n${proposal.markdown}` };
          } catch {
            return { ok: false, text: "Could not prepare a skill proposal. Try again." };
          }
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
    if (intent.kind === "local" || intent.kind === "skill" || intent.kind === "save_skill") {
      const toolId = intent.kind === "save_skill" ? "save_chat_skill" : intent.kind === "skill" ? "search_skills" : intent.tool;
      setToolTimeline([]);
      clearFailure();
      const turn = runAgentTurn({
        userId: "local-owner",
        sessionId: chat.id,
        text,
        modality: "chat",
        tools: agentTools(source, chat),
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
              tools: agentTools(source, chat),
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
      const notes = relevantMemories(memoriesForChat(source, chat), text);
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
    if (intent.kind === "create_bot") {
      const made = createBotFromSpeech(source, text);
      recordToolTurn(chat, text, made.ok ? made.reply : made.error, made.ok ? () => made.ws : undefined);
      if (made.ok) setNotice(made.reply);
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
    if (turnOwner.current !== draftOwner || !wsRef.current.chats.some((item) => item.id === chat.id)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await searchWeb({ data: { query, freeOnly: researchFreeOnly } });
      if (turnOwner.current !== draftOwner) return;
      setBusy(false);
      if (!wsRef.current.chats.some((item) => item.id === chat.id)) return;
      setResearchCitations(result.citations);
      setResearchReportQuestion(query);
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
      if (turnOwner.current !== draftOwner) return;
      setBusy(false);
      if (!wsRef.current.chats.some((item) => item.id === chat.id)) return;
      const message = "The search provider could not be reached. No citations were created.";
      const retry = () => {
        void runWebResearch(chat, query, action);
      };
      emitFailure("research", mountFailure({ message, action: "research_failed", target: "search" }, retry));
      recordToolTurn(chat, query, message, undefined, { tool: "web_search", ok: false, action });
      setResearchNote(message);
    }
  }

  async function askNotion(chat: Chat, text: string, confirmed = false, pageId: string | null = null, workspaceId = chat.notionWorkspaceId) {
    if (turnOwner.current !== draftOwner || !wsRef.current.chats.some((item) => item.id === chat.id)) return;
    setBusy(true);
    setError(null);
    const epoch = notionEpoch.current;
    try {
      if (!workspaceId) {
        const spaces = await listNotionWorkspaces();
        if (turnOwner.current !== draftOwner) return;
        setBusy(false);
        if (epoch !== notionEpoch.current || !wsRef.current.chats.some((c) => c.id === chat.id)) return;
        const target = spaces.find((space) => space.active);
        if (!target) { setError("Choose a connected Notion workspace in Plugins before using Notion here."); return; }
        setPending({ id: target.id, kind: "notion-workspace", label: "Use Notion workspace",
          detail: `Use ${target.name} for Notion requests in this conversation?`, confirm: "Use workspace",
          run: () => {
            setWs((prev) => ({ ...prev, chats: prev.chats.map((item) => item.id === chat.id ? { ...item, notionWorkspaceId: target.id } : item) }));
            void askNotion(chat, text, false, null, target.id);
          },
        });
        return;
      }
      const result = await notionCommand({ data: { text, confirmed, pageId, workspaceId } });
      if (turnOwner.current !== draftOwner) return;
      setBusy(false);
      if (epoch !== notionEpoch.current || !wsRef.current.chats.some((item) => item.id === chat.id)) return;
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
            void askNotion(chat, text, true, target.id, workspaceId);
          },
        });
        return;
      }
      if (!result.ok) {
        const message = result.error || "Notion did not complete the requested operation.";
        const retry = () => { void askNotion(chat, text, false, pageId, workspaceId); };
        reportFailure(message, "notion_operation_failed", "notion", retry, result.needsConfirmation ? "none" : "retry");
        recordToolTurn(chat, text, message, undefined, { tool: "notion", ok: false, action: "chat" });
        return;
      }
      const lines = [result.error, ...result.pages.map((page) => `${page.title} — ${page.url}`), result.content].filter(Boolean);
      if (lines.length && epoch === notionEpoch.current) {
        setNotionPreview({ owner: draftOwner, chatId: chat.id, text: lines.join("\n") });
      }
      recordToolTurn(chat, text, "Notion completed the request. Retrieved content is shown only in the current preview.");
    } catch {
      if (turnOwner.current !== draftOwner) return;
      setBusy(false);
      if (!wsRef.current.chats.some((item) => item.id === chat.id)) return;
      const message = "Notion could not be reached. Nothing was changed.";
      const retry = () => {
        void askNotion(chat, text, false, pageId, workspaceId);
      };
      if (emitFailure("notion", mountFailure({ message, action: "notion_unreachable", target: "notion" }, retry))) return;
      setError(message);
    }
  }

  async function askMcp(chat: Chat, text: string, confirmed = false, approvalServerId?: string, approvalId?: string) {
    if (turnOwner.current !== draftOwner || !wsRef.current.chats.some((item) => item.id === chat.id)) return;
    if (mcpInFlight.current) return;
    mcpInFlight.current = true;
    setBusy(true);
    setError(null);
    clearFailure();
    setToolResultStatus("running");
    try {
      const result = await mcpCommand({ data: { text, confirmed, approvalServerId, approvalId } });
      if (turnOwner.current !== draftOwner) return;
      setBusy(false);
      if (!wsRef.current.chats.some((item) => item.id === chat.id)) return;
      if (result.servers.every(isSavedMcpServer)) {
        setMcpServers(result.servers);
        setMcpSavedListState({
          status: "ready",
          servers: result.servers.map((server) => ({ id: server.id, label: server.label, kind: "saved", enabled: server.state !== "failed" })),
        });
      }
      if (result.needsConfirmation && "approvalServerId" in result && typeof result.approvalServerId === "string") {
        const reviewedServerId = result.approvalServerId;
        const review = result.approvalId;
        setToolResultStatus("idle");
        setPending({
          id: "mcp-call",
          kind: "mcp-call",
          label: "Call MCP tool",
          detail: result.error,
          confirm: "Call",
          run: () => {
            void askMcp(chat, text, true, reviewedServerId, review);
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
          void askMcp(chat, text, false);
        });
      }
      recordToolTurn(chat, text, `[${status}] ${reply}`, undefined, { tool: "mcp", ok: result.ok, action: "chat" });
    } catch {
      if (turnOwner.current !== draftOwner) return;
      setBusy(false);
      if (!wsRef.current.chats.some((item) => item.id === chat.id)) return;
      setToolResultStatus("error");
      const message = HONEST_FAILURE_MESSAGES.mcp_unreachable;
      reportFailure(message, "mcp_tool_failed", "mcp", () => {
        void askMcp(chat, text, false);
      });
    } finally {
      mcpInFlight.current = false;
    }
  }

  type TurnRequest = { id: string; body: ReturnType<typeof chatTurnBody> };

  async function deliver(
    chat: Chat,
    text: string,
    source: Workspace,
    resume = false,
    images: ImageAttachment[] = [],
    options?: { logicRoute?: LogicRouteId | null; skipUserMessage?: boolean; isolateOutputs?: boolean; accessNotes?: { id: string; text: string }[]; request?: TurnRequest; operationId?: string; replaceReplyId?: string; recovery?: Msg["deliveryRoute"] },
  ): Promise<string | null> {
    if (turnInFlight.current || turnOwner.current !== draftOwner) return null;
    const snapped = snapshotImages(images);
    if (shouldBlockForEmergencyStop(wsRef.current.halted, source.halted)) {
      reportEmergencyStop(chat.id, () => {
        void deliver(chat, text, wsRef.current, resume, snapped);
      });
      return null;
    }
    const botRoute = routeForBotChat(chat, { provider: providerChoice, modelTier });
    const savedRoute = options?.recovery;
    const selectedProvider = savedRoute?.provider ?? botRoute.provider;
    const selectedTier = savedRoute?.tier ?? botRoute.modelTier;
    if (selectedProvider.startsWith("mcp:")) {
      const chosen = discovered.find((item) => item.id === selectedProvider);
      if (!chosen?.usable) {
        reportFailure(chosen?.reason || "That MCP tool is not connected. Nothing was called and Grok was not substituted.", "model_unavailable", "mcp", null, "setup");
        return null;
      }
      const call = mcpToolCallText(selectedProvider, text);
      if (!call.ok) {
        reportFailure(call.error, "mcp_tool_failed", "mcp", null, "setup");
        return null;
      }
      void askMcp(chat, call.text);
      return null;
    }
    if (selectedProvider.startsWith("service:")) {
      const chosen = discovered.find((item) => item.id === selectedProvider);
      if (!chosen?.usable) {
        reportFailure(chosen?.reason || "That service is not connected. Nothing was sent and Grok was not substituted.", "model_unavailable", "provider", null, "setup");
        return null;
      }
      const name = selectedProvider.slice("service:".length);
      if (name === "social") window.location.assign("/social");
      else if (name === "gpt-wrapper") window.location.assign("/gpt-wrapper");
      else if (name === "drive") setCloudPickerOpen(true);
      else if (name === "notion") setView("connected");
      return null;
    }
    const activeLogic = savedRoute ? (isLogicRouteId(savedRoute.provider) ? savedRoute.provider : null) : options && "logicRoute" in options
      ? options.logicRoute ?? null
      : botRoute.fromBot ? null : logicRoute ?? (isLogicRouteId(selectedProvider) ? selectedProvider : null);
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
    const isCustomProvider = selectedProvider.startsWith("custom:") && !activeLogic;
    const routedRunner = !activeLogic && !isCustomProvider && (selectedProvider === "openrouter" || selectedProvider === "nemotron" || selectedProvider === "ollama");
    if (routedRunner && (selectedProvider === "openrouter" || selectedProvider === "nemotron") && liveProviders.openrouter !== true) {
      reportFailure("OpenRouter is selected, but no OpenRouter key is connected. Nothing was sent and Grok was not substituted.", "model_unavailable", "provider", null, "setup");
      return null;
    }
    const otherReady = !activeLogic && !isCustomProvider && selectedProvider !== "grok" && liveProviders[selectedProvider as "openai" | "anthropic" | "gemini" | "openrouter"] === true;
    let routed = chosenProvider(activeLogic || isCustomProvider ? "grok" : selectedProvider, isCustomProvider ? true : grokConfigured);
    if (!savedRoute && !routedRunner && !otherReady && !activeLogic && !isCustomProvider && !routed.ok) {
      const switched = failover(selectedProvider, grokConfigured === true, selectedProvider === "gemini" ? "none" : failoverPolicy);
      if (switched.provider === "grok") {
        routed = chosenProvider("grok", grokConfigured);
        if (routed.ok) setNotice(switched.note);
      }
    }
    const orchestrating = savedRoute ? savedRoute.orchestrated : resolveSendPath(composerEffort).path === "orchestrator";
    const consultPlan = orchestrating
      ? planModelConsult({ orchestrator: savedRoute?.provider ?? consultModel, modules: consultModules, question: text })
      : null;
    if (consultPlan && !consultPlan.ok) {
      reportFailure(consultPlan.error, "model_unavailable", "provider", () => {
        void deliver(chat, text, wsRef.current, resume, snapped);
      });
      return null;
    }
    if (!orchestrating && !routedRunner && !otherReady && !activeLogic && !isCustomProvider && !routed.ok) {
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
    if (options?.replaceReplyId && live.at(-1)?.id !== options.replaceReplyId) {
      setError("The reply changed before regeneration. Choose the current reply to regenerate.");
      return null;
    }
    const messages = options?.replaceReplyId ? live.slice(0, -1) : selectRetryMessages(chat.messages, live);
    if (resume && messages.at(-1)?.role === "assistant") return null;
    const history = historyForDeliver(messages, resume);
    const title = resume || messages.length > 0 ? chat.title : text.replace(/\s+/g, " ").slice(0, 48);
    const userMessageId = options?.skipUserMessage ? null : resume ? messages.at(-1)?.id ?? null : crypto.randomUUID();
    setTurnChat({ ownerId: draftOwner, chatId: chat.id });
    setBusy(true);
    setLiveText("");
    setError(null);
    setFailure(null);
    setToolTimeline([]);
    turnAbort.current?.abort();
    const generation = ++turnGen.current;
    const controller = new AbortController();
    turnAbort.current = controller;
    const { signal, cleanup: clearTurnTimeout } = boundAbortSignal(controller.signal, 30_000);
    const token = getBearerToken();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    turnInFlight.current = true;
    let operationId: string;
    try {
      operationId = options?.request?.id ?? options?.operationId ?? await prepareTurnId(`${prefix}/api/mind/turn`, token ? { Authorization: `Bearer ${token}` } : {}, signal);
      if (generation !== turnGen.current || turnOwner.current !== draftOwner || signal.aborted || wsRef.current.halted ||
          !wsRef.current.chats.some((item) => item.id === chat.id)) throw new Error();
    } catch {
      clearTurnTimeout();
      if (generation === turnGen.current) {
        turnInFlight.current = false;
        turnAbort.current = null;
        setBusy(false);
        setTurnChat(null);
        setError("This send could not be prepared. No model was called.");
      }
      return null;
    }
    const markDelivery = (delivery: Msg["delivery"]) => {
      if (!userMessageId || options?.replaceReplyId) return;
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((item) => item.id === chat.id
          ? { ...item, messages: item.messages.map((message) => message.id === userMessageId ? { ...message, delivery, deliveryOperationId: operationId } : message) }
          : item),
      }));
    };
    if (!resume && userMessageId) {
      deliverStoredUser.current = true;
      const userMsg: Msg = {
        id: userMessageId,
        role: "user",
        content: historyTextForImages(text, snapped),
        at: new Date().toISOString(),
        delivery: "submitted",
        deliveryOperationId: operationId,
        images: snapped.length ? snapped.map((image) => ({ dataUrl: image.dataUrl, name: image.name, origin: image.origin })) : undefined,
      };
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chat.id ? { ...item, title, messages: [...item.messages, userMsg] } : item,
        ),
      }));
    } else if (resume) {
      markDelivery("submitted");
    }
    const request: TurnRequest = options?.request ?? {
      id: operationId,
      body: chatTurnBody({
          chatId: chat.id,
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
          memoryContext: [
            ...(options?.accessNotes ?? []),
            ...relevantMemories(memoriesForChat(source, chat), text).map((item) => ({ id: item.id, text: item.text })),
          ].slice(0, 12),
          botKnowledge: chat.botKnowledge ?? "",
          provider: consultPlan && consultPlan.ok
            ? consultPlan.plan.orchestrator
            : activeLogic ?? (isCustomProvider || otherReady || routedRunner ? selectedProvider : (routed.ok ? routed.id : selectedProvider)),
          modelTier: selectedTier,
          requestedModel: savedRoute?.model ?? (selectedProvider === "grok" && !activeLogic && !consultPlan ? grokModel : providerModels[selectedProvider] ?? null),
          logicRoute: consultPlan && consultPlan.ok ? null : activeLogic,
          orchestrator: consultPlan && consultPlan.ok ? consultPlan.plan.orchestrator : null,
          composerMode: orchestrating ? "orchestrator" : undefined,
          identity: ADRIAN_MIND_IDENTITY,
          consult: consultPlan && consultPlan.ok ? {
            available: consultPlan.plan.available,
            helpers: consultPlan.plan.helpers,
            purpose: consultPlan.plan.purpose,
          } : null,
          images: snapped.map((image) => ({ dataUrl: image.dataUrl, name: image.name, origin: image.origin })),
          personalityId: chat.personalityId ?? "assistant",
          customPersonality: chat.customPersonality ?? "",
        }),
    };
    function reportTurnError(message: string, deliveryUncertain: boolean) {
      const useOriginal = deliveryUncertain || options?.request !== undefined || options?.operationId !== undefined;
      markDelivery(useOriginal ? "unconfirmed" : "failed");
      const retry = () => {
        if (turnInFlight.current || turnOwner.current !== draftOwner) return;
        const thread = wsRef.current.chats.find((item) => item.id === chat.id);
        if (!thread) return;
        if (options?.replaceReplyId && thread.messages.at(-1)?.id === options.replaceReplyId) {
          const prior = prepareRegenerate(wsRef.current, chat.id);
          if (!("error" in prior)) void deliver(prior.chat, text, wsRef.current, true, snapped, { ...options, request: useOriginal ? request : undefined });
          return;
        }
        if (thread.messages.at(-1)?.role === "assistant") return;
        void deliver(thread, text, wsRef.current, true, snapped, {
          ...options, request: useOriginal ? request : undefined,
        });
      };
      const kind = classifyHonestFailure(message);
      const description = useOriginal ? `${message} Retry uses the original send ID so the server can recognize an already received request.` : message;
      reportFailure(description, kind ? honestFailureAuditAction(kind) : "chat_failed", chat.id, retry);
      setFailure((current) => current ? { ...current, chatId: chat.id } : current);
    }
    try {
      const fingerprint = await sha256(JSON.stringify(request.body));
      if (savedRoute && fingerprint !== savedRoute.fingerprint) {
        markDelivery("unconfirmed");
        setError("The original message context changed. Its previous delivery is unconfirmed. Review the thread before starting a new send.");
        return null;
      }
      if (userMessageId && !options?.replaceReplyId) {
        const deliveryRoute = { provider: String(request.body.provider), model: typeof request.body.requestedModel === "string" ? request.body.requestedModel : null,
          tier: selectedTier, orchestrated: request.body.composerMode === "orchestrator", fingerprint };
        setWs((prev) => ({ ...prev, chats: prev.chats.map((item) => item.id === chat.id
          ? { ...item, messages: item.messages.map((message) => message.id === userMessageId ? { ...message, deliveryRoute } : message) }
          : item) }));
      }
      const result = await consumeMindTurn({
        url: `${prefix}/api/mind/turn`,
        signal,
        headers: {
          "x-mind-turn-id": request.id,
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: request.body,
        onDelta: (chunk) => {
          if (generation !== turnGen.current || turnOwner.current !== draftOwner) return;
          setLiveText((current) => current + chunk);
        },
      });
      if (generation !== turnGen.current || turnOwner.current !== draftOwner) return null;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      if (result.ok && result.provider) setNotice(`${result.provider} answered.`);
      if (!shouldStoreReply(result)) {
        const message = result.ok ? "The provider returned an empty reply." : result.error;
        if (message === STOPPED_REPLY) {
          markDelivery("stopped");
          return null;
        }
        reportTurnError(message, result.ok || result.deliveryUncertain === true);
        return null;
      }
      setWs((prev) => {
        const next = {
          ...prev,
          chats: prev.chats.map((item) =>
            item.id === chat.id && (!options?.replaceReplyId || item.messages.at(-1)?.id === options.replaceReplyId)
              ? {
                  ...item,
                  messages: [
                    ...item.messages.filter((message) => message.id !== options?.replaceReplyId).map((message) => message.id === userMessageId ? { ...message, delivery: undefined, deliveryOperationId: undefined, deliveryRoute: undefined } : message),
                    {
                      id: crypto.randomUUID(),
                      role: "assistant" as const,
                      content: result.text,
                      at: new Date().toISOString(),
                      model: result.model,
                      routingMode,
                      ...(result.provider ? { provider: result.provider } : {}),
                      ...(result.requestedModel ? { requestedModel: result.requestedModel } : {}),
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
            provider: result.provider || undefined,
            requestedModel: result.requestedModel || undefined,
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
      if (generation !== turnGen.current || turnOwner.current !== draftOwner) return null;
      setBusy(false);
      setLiveText("");
      if (turnAbort.current === controller) turnAbort.current = null;
      if (controller.signal.aborted) {
        markDelivery("stopped");
        return null;
      }
      const message = normalizeClientFailureMessage(caught);
      reportTurnError(message, true);
      return null;
    } finally {
      clearTurnTimeout();
      if (generation === turnGen.current) {
        setBusy(false);
        if (turnAbort.current === controller) turnAbort.current = null;
        turnInFlight.current = false;
        setTurnChat(null);
      }
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
    const name = imageDownloadName(src, alt);
    if (!name) { setError("Unrecognized image format."); return; }
    link.href = src;
    link.download = name;
    link.click();
  }

  function saveImageToComposer(src: string, alt: string) {
    if (!src.startsWith("data:image/")) {
      setError("Only in-chat data URLs can be saved back into the composer.");
      return;
    }
    setPendingImages((prev) => {
      if (prev.length >= 4) {
        setNotice(null);
        setError("You can attach up to 4 images per message.");
        return prev;
      }
      setError(null);
      setNotice("Image added to the composer.");
      return [...prev, { dataUrl: src, name: alt || `saved-${prev.length + 1}.jpg` }];
    });

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
    const branch = { ...revised.chat, id: crypto.randomUUID(), title: `${active.title.slice(0, 68)} (edited)`, messages: revised.chat.messages.map((msg) => ({ ...msg, id: crypto.randomUUID() })) };
    const source = { ...wsRef.current, chats: [branch, ...wsRef.current.chats] };
    setWs(() => source);
    setActiveId(branch.id);
    void deliver(branch, revised.text, source, true, snapshotImages(toImageAttachments(revised.images)));
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
    void deliver(prepared.chat, prepared.text, prepared.ws, true, snapshotImages(toImageAttachments(prepared.images)), {
      replaceReplyId: active.messages.at(-1)?.id,
    });
  }

  function retryLast() {
    if (!active || busy || turnInFlight.current) return;
    const imageRetry = imageRetryPlan(active.messages, active.id);
    if (imageRetry) {
      void runImagine(imageRetry.prompt, active, { retry: true });
      return;
    }
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop(active.id, () => retryLast());
      return;
    }
    const prepared = prepareRetry(wsRef.current, active.id);
    if ("error" in prepared) {
      setError(prepared.error);
      return;
    }
    const last = prepared.chat.messages.at(-1);
    if (last?.role !== "user") return;
    const unresolved = last.delivery === "submitted" || last.delivery === "unconfirmed";
    if (unresolved && (!last.deliveryOperationId || !last.deliveryRoute)) {
      setError("The outcome of this earlier send is unknown. Its original send details are unavailable. Review the conversation before starting a new send.");
      return;
    }
    setError(null);
    void deliver(prepared.chat, prepared.text, wsRef.current, true, snapshotImages(toImageAttachments(prepared.images)), {
      operationId: unresolved ? last.deliveryOperationId : undefined,
      recovery: last.deliveryRoute,
    });
  }

  function exportActive(textOnly = false) {
    if (!active) return;
    const packed = exportChat(ws, active.id);
    if ("error" in packed) {
      setError(packed.error);
      return;
    }
    const plain = active.messages.map((message) => {
      const speaker = message.role === "user" ? "You" : [message.provider, message.model].filter(Boolean).join(" · ") || "Assistant";
      return `${speaker}
${message.content}`;
    }).join("\n\n");
    const blob = new Blob([textOnly ? plain : packed.json], { type: textOnly ? "text/plain;charset=utf-8" : "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = textOnly ? packed.filename.replace(/\.json$/, ".txt") : packed.filename;
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

  async function deliverPlanned(chat: Chat, full: string, source: Workspace, images: ImageAttachment[]): Promise<boolean> {
    if (turnOwner.current !== draftOwner) return false;
    deliverStoredUser.current = false;
    const bot = routeForBotChat(chat, { provider: providerChoice, modelTier });
    const primary = bot.fromBot ? (isLogicRouteId(bot.provider) ? bot.provider : null) : logicRoute ?? (isLogicRouteId(providerChoice) ? providerChoice : null);
    const seats = logicRoutes.map((item) => ({ id: item.id, label: item.label, ready: item.ready, reason: item.reason }));
    const plan = planRouting({ mode: bot.fromBot ? "A" : routingMode, primary, seats, panel: routingPanel });
    if (!plan.ok) {
      setError(plan.reason);
      return false;
    }
    setNotice(plan.note);
    for (let index = 0; index < plan.calls.length; index += 1) {
      const call = plan.calls[index];
      if (!call) return false;
      const textOut = await deliver(chat, full, index === 0 ? source : wsRef.current, false, images, {
        ...(call.route ? { logicRoute: call.route } : {}),
        skipUserMessage: index > 0,
        isolateOutputs: index > 0,
      });
      if (textOut == null) return false;
      if (index === plan.calls.length - 1 && textOut.trim() &&
          currentVoiceScope.current === JSON.stringify([draftOwner, "chat", chat.id]) &&
          !wsRef.current.halted && !document.hidden && !voiceSession.current?.isOpen) {
        let readAloud = false;
        try { readAloud = localStorage.getItem("adrian-speak-auto-read") === "on"; } catch { /* Storage may be unavailable. */ }
        if (readAloud) void speak(textOut);
      }
    }
    return true;
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
    const spokenImage = text.match(/^(?:please\s+)?(?:generate|draw|make|create)(?:\s+me)?(?:\s+an|\s+a)?\s+(?:image|picture|photo)(?:\s+of)?\s+(.+)$/i);
    if (spokenImage?.[1]) {
      await runImagine(spokenImage[1], null);
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
    const attached = file ? `\n\nAttached file ${file.name}:\n${file.text}` : "";
    const full = `${text || (images.length ? "Describe the attached image." : "")}${attached}`;
    if (full.length > 8000) {
      setError("The message and attached text exceed the 8,000-character limit. Shorten them before sending.");
      return;
    }
    setDraft("");
    setStaged(null);
    setPendingImages([]);
    const source = { ...ws, chats: [made.chat, ...ws.chats] };
    setActiveId(made.chat.id);
    if (!wsRef.current.chats.some((item) => item.id === made.chat.id)) {
      wsRef.current = { ...wsRef.current, chats: [made.chat, ...wsRef.current.chats] };
    }
    setView("chat");
    setWs((prev) => {
      let next = { ...prev, chats: [made.chat, ...prev.chats] };
      if (file && !made.chat.temporary) next = addLocalFile(next, { name: file.name, text: file.text, projectId: projectChoice || null });
      return pushAudit(next, "create_chat", made.chat.id, `memory ${made.chat.memory}; ${made.chat.autonomy}`);
    });
    if (settleIntent(made.chat, full, source)) return;
    const effortPath = resolveSendPath(composerEffort);
    if (effortPath.notice) setNotice(effortPath.notice);
    const finished = await deliverPlanned(made.chat, full, { ...ws, chats: [made.chat, ...ws.chats] }, images);
    if (!finished && !deliverStoredUser.current) {
      const scope = JSON.stringify([draftOwner, made.chat.id, made.chat.temporary]);
      const persist = Boolean(draftOwner) && !made.chat.temporary;
      setDraftInScope(scope, persist, (current) => current || text);
      if (file) setStagedInScope(scope, persist, (current) => current ?? file);
      if (images.length) setImagesInScope(scope, persist, (current) => current.length ? current : images);
    }
    if (finished) await releaseNextCue();
  }

  async function startResearch(question = researchText, retry?: ResearchReport) {
    const query = question.trim();
    if (turnOwner.current !== draftOwner || !draftOwner) return;
    if (!query || researchFlight.current) return;
    if (wsRef.current.halted) {
      reportEmergencyStop("search", () => {
        void startResearch(query, retry);
      });
      return;
    }
    researchFlight.current = true;
    setResearchPending(true);
    try {
      const result = await searchWeb({ data: { query, freeOnly: researchFreeOnly, retryQueries: retry?.steps?.filter((step) => !step.ok).map((step) => step.query) } });
      if (!draftOwner || turnOwner.current !== draftOwner) return;
      setError(null);
      setWs((prev) => pushAudit(prev, result.configured && result.ok ? "research_result" : "research_refused", "search", result.ok ? `${result.citations.length} sources` : "no citation"));
      if (!result.ok) {
        reportFailure(result.error || "Research refused. No citations were created.", "research_failed", "search", () => {
          void startResearch(query, retry);
        });
      } else {
        const steps = retry?.steps?.map((step) => result.steps?.find((current) => current.query === step.query) ?? step) ?? result.steps;
        const citations = [...new Map([...(retry?.citations ?? []), ...result.citations].map((item) => [item.url, item])).values()];
        const summary = retry && steps ? `${steps.filter((step) => step.ok).length} of ${steps.length} searches succeeded.` : result.summary || "";
        const report: ResearchReport = { id: retry?.id ?? crypto.randomUUID(), question: query, steps, summary, citations, at: new Date().toISOString() };
        setResearchReportQuestion(query);
        setResearchCitations(citations);
        setResearchNote(summary);
        setResearchSteps(steps);
        setResearchHistory((current) => {
          if (turnOwner.current !== draftOwner) return current;
          const next = [report, ...current.filter((item) => item.id !== report.id)].slice(0, 8);
          try { localStorage.setItem(`amcos.research.v2.${draftOwner}`, JSON.stringify(next)); } catch { /* private mode */ }
          return next;
        });
        clearFailure();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The search did not run. No citations were created.";
      reportFailure(message, "research_failed", "search", () => {
        void startResearch(query, retry);
      });
    } finally {
      researchFlight.current = false;
      setResearchPending(false);
    }
  }

  async function runPlanner() {
    if (currentFreeOnly.current) { setAgentNote("Free-only mode is on. This action uses a separate xAI provider that may charge."); return; }
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
    const plannerScope = active ? workspaceForChat(ws, active) : emptyWorkspace();
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
          freeOnly: currentFreeOnly.current,
          projects: plannerScope.projects.map((project) => project.name),
          chats: plannerScope.chats.map((chat) => chat.title),
          notes: plannerScope.memories.map((note) => note.text),
          modelTier,
          images: plannerImages.map((image) => ({ dataUrl: image.dataUrl, name: image.name, origin: image.origin })),
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
      const agentImages: ImageAttachment[] = (payload.images ?? [])
        .filter((image) => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
        .map((image, index) => ({
          dataUrl: image.dataUrl,
          origin: "generated" as const,
          name: image.name || `imagine-${index + 1}.jpg`,
          mime: image.mime,
        }));
      if (agentImages.length) {
        setPendingImages((previous) => previous.length + agentImages.length <= 4 ? [...previous, ...agentImages] : previous);
        setAgentImages(agentImages);
      } else {
        setAgentImages([]);
      }
      setAgentNote((payload.ok ? payload.text ?? "" : payload.error || "The planner did not finish.") + (payload.ok ? modelBit : "") + (agentImages.length ? ` · ${agentImages.length} image available below.` : ""));
      setWs((prev) => pushAudit(prev, "agent_plan", "bounded", payload.ok ? (agentImages.length ? "finished+imagine" : "finished") : "stopped"));
    } catch {
      if (controller.signal.aborted) setAgentNote("Stopped. The unfinished reply was not saved.");
      else setAgentNote("The planner did not finish. Nothing was marked finished.");
    } finally {
      if (agentAbort.current === controller) agentAbort.current = null;
      setAgentBusy(false);
    }
  }

  function rememberCue(next: QueuedChatMessage[]) {
    cueRef.current = next;
    setCued(next);
  }

  async function releaseNextCue(onlyChatId?: string, single = false) {
    if (wsRef.current.halted || turnInFlight.current || !draftOwner || turnOwner.current !== draftOwner) return;
    const held = takeNextCue(cueRef.current, (item) => item.ownerId === draftOwner && (single || !item.paused) && (!onlyChatId || item.chatId === onlyChatId));
    const entry = held.next;
    if (!entry) return;
    rememberCue(held.queue);
    const chat = wsRef.current.chats.find((item) => item.id === entry.chatId);
    if (!chat) {
      setNotice("A queued message was dropped because its conversation was removed.");
      if (!single) await releaseNextCue(onlyChatId);
      return;
    }
    const finished = await entry.dispatch(chat, wsRef.current);
    if (turnOwner.current !== entry.ownerId) return;
    if (!finished && !deliverStoredUser.current) {
      rememberCue(restoreCue(cueRef.current, wsRef.current.halted ? { ...entry, paused: true } : entry));
      setNotice("The next message stayed queued in its conversation.");
      return;
    }
    if (finished && !single) await releaseNextCue(onlyChatId);
  }

  async function sendInChat() {
    if (wsRef.current.halted) { setError("Emergency stop is on."); return; }
    if (busy || turnInFlight.current) {
      const text = draft.trim();
      if (!active || !draftOwner || !text) return;
      if (staged || pendingImages.length || parseImagineCommand(text) !== null) {
        setError("Wait for the active reply before sending an attachment or an image request.");
        return;
      }
      const result = cueMessage(cueRef.current, {
        id: crypto.randomUUID(),
        text,
        chatId: active.id,
        ownerId: draftOwner,
        dispatch: (chat, source) => deliverPlanned(chat, text, source, []),
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      rememberCue(result.queue);
      setDraft("");
      setError(null);
      setNotice("Queued. This message will send in this conversation.");
      return;
    }
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
      mode: effectiveRoute.fromBot ? "A" : routingMode,
      primary: isLogicRouteId(effectiveProvider) ? effectiveProvider : null,
      seats: logicRoutes.map((item) => ({ id: item.id, label: item.label, ready: item.ready, reason: item.reason })),
      panel: routingPanel,
    });
    if (!chatPlan.ok) {
      setError(chatPlan.reason);
      return;
    }
    const attached = file ? `\n\nAttached file ${file.name}:\n${file.text}` : "";
    const full = `${text || (images.length ? "Describe the attached image." : "Read the attached file.")}${attached}`;
    if (full.length > 8000) {
      setError("The message and attached text exceed the 8,000-character limit. Shorten them before sending.");
      return;
    }
    setDraft("");
    setStaged(null);
    setPendingImages([]);
    const source = ws;
    if (settleIntent(active, full, source)) {
      if (file && !active.temporary) setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: active.projectId }));
      await releaseNextCue();
      return;
    }
    if (file && !active.temporary) {
      setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: active.projectId }));
    }
    const effortPath = resolveSendPath(composerEffort);
    if (effortPath.notice) setNotice(effortPath.notice);
    const finished = await deliverPlanned(active, full, ws, images);
    if (!finished && !deliverStoredUser.current) {
      setDraft((current) => current || text);
      if (file) setStaged((current) => current ?? file);
      if (images.length) setPendingImages((current) => current.length ? current : images);
    }
    if (finished) await releaseNextCue();
  }

  async function runImagine(promptRaw?: string, targetChat: Chat | null = active, opts?: { retry?: boolean }) {
    if (currentFreeOnly.current) { setError("Free-only mode is on. This action uses a separate xAI provider that may charge."); return; }
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
    const imageScope = JSON.stringify([draftOwner, chatId, chat.temporary]);
    const persistImages = Boolean(draftOwner) && !chat.temporary;
    if (!targetChat && pendingImages.length) setImagesInScope(imageScope, persistImages, pendingImages);
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
                    kind: "error" as const,
                    content: "Couldn't create the image. Nothing was saved. Try again, or edit your prompt.",
                    at: new Date().toISOString(),
                  },
                ],
              }
            : item,
        ),
      }));
      setWs((prev) => pushAudit(prev, "image_generation_failed", chatId, failure.message));
    };
    imagineInFlight.current = true;
    try {
      const response = await fetch(`${prefix}/api/mind/media/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt, n: 1, freeOnly: currentFreeOnly.current }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        model?: string;
        images?: { dataUrl: string; mime?: string; name?: string }[];
      };
      if (turnOwner.current !== draftOwner) return;
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
        origin: "generated",
        name: image.name || `imagine-${index + 1}.jpg`,
        mime: image.mime,
      }));
      const model = payload.model?.trim();
      setImagesInScope(imageScope, persistImages, (previous) => {
        if (previous.length + images.length > 4) {
          setNotice("Image created in this chat. The composer is full.");
          return previous;
        }
        setNotice("Image created and added to the composer.");
        return [...previous, ...images];
      });
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
                      content: model ? `Generated with ${model}.` : "Image generated. The provider did not report a model.",
                      at: new Date().toISOString(),
                      model,
                      images: images.map((image) => ({ dataUrl: image.dataUrl, name: image.name, origin: image.origin })),
                    },
                  ],
                }
              : item,
          ),
        };
        return pushAudit(next, "imagine_generate", chatId, model || "model unreported");
      });
    } catch (caught) {
      if (turnOwner.current !== draftOwner) return;
      const normalized = normalizeClientFailureMessage(caught);
      const kind = classifyHonestFailure(normalized);
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

  async function runVideo(promptRaw?: string) {
    if (currentFreeOnly.current) { setError("Free-only mode is on. This action uses a separate xAI provider that may charge."); return; }
    if (videoInFlight.current) return;
    const prompt = (promptRaw ?? draft).trim();
    if (!prompt) {
      setError("Write what the video should show, then send.");
      return;
    }
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      reportEmergencyStop("video", () => {
        void runVideo(prompt);
      });
      return;
    }
    setDraft("");
    setError(null);
    setNotice("Video started. A short clip usually takes about a minute.");
    const token = getBearerToken();
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    let chat = active;
    if (!chat) {
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
        pushAudit({ ...prev, chats: [made.chat, ...prev.chats] }, "create_chat", made.chat.id, "video"),
      );
    } else {
      setView("chat");
    }
    const chatId = chat.id;
    const userMsg = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: `/video ${prompt}`,
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
    videoInFlight.current = true;
    const fail = (message: string) => {
      setError(message);
      setWs((prev) => ({
        ...prev,
        chats: prev.chats.map((item) =>
          item.id === chatId
            ? {
                ...item,
                messages: [...item.messages, { id: crypto.randomUUID(), role: "assistant" as const, content: message, at: new Date().toISOString() }],
              }
            : item,
        ),
      }));
    };
    try {
      const start = await fetch(`${prefix}/api/mind/media/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kind: "video", action: "start", prompt, duration: 5, freeOnly: currentFreeOnly.current }),
      });
      const started = (await start.json()) as { ok?: boolean; error?: string; requestId?: string; model?: string };
      if (!start.ok || !started.ok || !started.requestId) {
        fail(started.error || "Video did not start.");
        return;
      }
      const requestId = started.requestId;
      const model = started.model || "grok-imagine-video";
      const deadline = Date.now() + 8 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const statusResponse = await fetch(`${prefix}/api/mind/media/generate`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ kind: "video", action: "status", requestId }),
        });
        const status = (await statusResponse.json()) as { ok?: boolean; error?: string; state?: string; url?: string; model?: string };
        if (status.state === "done" && status.url) {
          setNotice("Video is ready.");
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
                        content: `Generated with ${status.model || model}. The clip is below. The link expires, so play or download it while it is here.`,
                        at: new Date().toISOString(),
                        model: status.model || model,
                        videoUrl: status.url,
                      },
                    ],
                  }
                : item,
            ),
          }));
          return;
        }
        if (!statusResponse.ok || status.ok === false || status.state === "failed") {
          fail(status.error || "Video generation failed.");
          return;
        }
      }
      fail("The video is still rendering. Nothing was invented in its place.");
    } catch {
      fail("Could not reach the video service.");
    } finally {
      videoInFlight.current = false;
    }
  }

  function openImagineEditor(image: string) {
    if (!image.startsWith("data:image/")) return;
    setImagineEditError(null);
    setImagineEdit({ image, text: "", returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  }

  function closeImagineEditor() {
    const focus = imagineEdit?.returnFocus;
    setImagineEdit(null);
    setImagineEditError(null);
    requestAnimationFrame(() => focus?.focus());
  }

  async function runImagineEdit(imageDataUrl: string, promptRaw: string) {
    if (currentFreeOnly.current) { setImagineEditError("Free-only mode is on. This action uses a separate xAI provider that may charge."); return; }
    if (imagineInFlight.current || busy) return;
    const prompt = promptRaw.trim();
    if (!prompt) {
      setImagineEditError("Describe the edit you want to generate.");
      return;
    }
    if (!imageDataUrl.startsWith("data:image/")) {
      setImagineEditError("Choose an image stored directly in this chat.");
      return;
    }
    if (shouldBlockForEmergencyStop(wsRef.current.halted)) {
      setImagineEditError("The emergency stop is active. Close this dialog to clear the stop, then reopen the editor.");
      return;
    }
    setImagineEditError(null);
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
        body: JSON.stringify({ prompt, image: imageDataUrl, mode: "edit", n: 1, freeOnly: currentFreeOnly.current }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        model?: string;
        images?: { dataUrl: string; mime?: string; name?: string }[];
      };
      if (turnOwner.current !== draftOwner) return;
      if (!response.ok || !payload.ok || !payload.images?.length) {
        const failure = imageGenerationFailure({
          mode: "edit",
          prompt,
          status: response.status,
          serverError: payload.error || "",
          imageDataUrl,
          n: 1,
        });
        setImagineEditError(failure.message);
        setWs((previous) => pushAudit(previous, failure.kind, failure.target, failure.message));
        return;
      }
      const images: ImageAttachment[] = payload.images.map((image, index) => ({
        dataUrl: image.dataUrl,
        origin: "edited",
        name: image.name || `imagine-edit-${index + 1}.jpg`,
        mime: image.mime,
      }));
      if (!active) {
        setPendingImages((previous) => {
          if (previous.length + images.length > 4) {
            setImagineEdit((previousEdit) => previousEdit && { ...previousEdit, result: images[0] });
            setImagineEditError("The composer is full. Download the edited image before closing.");
            return previous;
          }
          closeImagineEditor();
          setNotice("Edited image added to the composer.");
          return [...previous, ...images];
        });
      } else {
        closeImagineEditor();
        setNotice("Edited image added to this chat.");
      }
      clearFailure();
      if (active) {
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
                      content: payload.model ? `Edited with ${payload.model}.` : "Image edited. The provider did not report a model.",
                      at: new Date().toISOString(),
                      model: payload.model,
                      images: images.map((image) => ({ dataUrl: image.dataUrl, name: image.name, origin: image.origin })),
                    },
                  ],
                }
              : item,
          ),
        }));
      }
    } catch (caught) {
      if (turnOwner.current !== draftOwner) return;
      const normalized = normalizeClientFailureMessage(caught);
      const failure = imageGenerationFailure({
        mode: "edit",
        prompt,
        caughtMessage: normalized,
        imageDataUrl,
        n: 1,
      });
      setImagineEditError(failure.message);
      setWs((previous) => pushAudit(previous, failure.kind, failure.target, failure.message));
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
        setError(null); setNotice("Image attached.");
        return [...prev, { dataUrl: item.dataUrl, name: item.name, mime: item.mime, origin: "attached" }];
      });
      return;
    }
    const remaining = 8000 - (draft.trim() || "Read the attached file.").length - `\n\nAttached file ${item.name}:\n`.length;
    if (item.text.length > remaining) {
      setExcerpt({ scope: draftScope, file: { name: item.name, text: item.text }, limit: Math.max(0, remaining) });
      return;
    }
    setStaged({ name: item.name, text: item.text });
    setError(null);
  }

  async function addImageAttachment(file: File) {
    const rejected = explainRejectedImageFile(file);
    if (rejected) {
      setError(rejected);
      setNotice(null);
      return;
    }
    try {
      const scaled = await fileToDownscaledDataUrl(file);
      setPendingImages((prev) => {
        if (prev.length >= 4) {
          setError("You can attach up to 4 images per message.");
          setNotice(null);
          return prev;
        }
        setError(null);
        setNotice(`Image “${scaled.name}” staged${scaled.scaled ? " (downscaled)" : ""}. Send uses the selected chat route.`);
        return [...prev, { dataUrl: scaled.dataUrl, name: scaled.name, mime: scaled.mime, origin: "attached" }];
      });
    } catch {
      setError("That image could not be prepared.");
    }
  }

  async function onPicked(file: File, inspection: View | null) {
    setNotice(null);
    setError(null);
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
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const pdf = isPdf ? await extractPdfText(new Uint8Array(await file.arrayBuffer())) : null;
    if (pdf && !pdf.ok) {
      setError(pdf.error);
      return;
    }
    const text = pdf ? pdf.text : await file.text();
    if (!text.trim() || text.includes("\u0000")) {
      setError("Only text files can be read here. Nothing was uploaded.");
      return;
    }
    const coverage = pdf?.coverage ? `[Partial PDF: ${pdf.coverage}]\n` : "";
    const stagedFile = { name: file.name, text: coverage + text.slice(0, 40000) };
    const partial = pdf?.partial || text.length > stagedFile.text.length;
    if (view === "files") {
      if (wsRef.current.files.length >= 40) {
        setError("Library holds 40 text copies. Remove an existing copy before uploading another.");
        return;
      }
      const savedId = crypto.randomUUID();
      setWs((prev) => {
        return addLocalFile(prev, { id: savedId, name: stagedFile.name, text: coverage + text, partial, projectId: libraryProjectId || projectChoice || null });
      });
      setOpenFileId(savedId);
      setLibraryBand("preview");
      const savedCopy = partial ? `a partial text copy of “${file.name}”` : pdf ? `extracted text from “${file.name}”` : `“${file.name}”`;
      setNotice(`Saved ${savedCopy} to Library. ${pdf?.coverage ?? ""}`.trim());
      return;
    }
    const remaining = 8000 - (draft.trim() || "Read the attached file.").length - `\n\nAttached file ${file.name}:\n`.length;
    if (!inspection && stagedFile.text.length > remaining) {
      setExcerpt({ scope: draftScope, file: stagedFile, limit: Math.max(0, remaining) });
      return;
    }
    setStaged(stagedFile);
    setError(null);
    if (inspection) {
      await inspectWithRea(stagedFile, inspection);
      return;
    }
    setNotice(`“${file.name}” is staged${partial ? " as a partial text copy" : pdf ? " as extracted text" : ""}. ${pdf?.coverage ?? ""} Press Send to include it, or Analyze File to run REA.`);
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
    setImportChecking(true);
    setImportStatus("");
    setImportError(null);
    setImportPreview(null);
    try {
      const opened = await unpackWorkspace(await file.text());
      if (!opened.ok) {
        setImportError(opened.error);
        return;
      }
      setImportPreview({ workspace: opened.workspace, name: file.name });
    } catch {
      setImportError("This archive could not be read. Choose another file to try again.");
    } finally {
      setImportChecking(false);
    }
  }

  function toggleStop() {
    return wsRef.current.halted ? clearEmergencyStop() : pressEmergencyStop();
  }
  async function pressEmergencyStop() {
    stopVoiceSession();
    clearedStop.current = false;
    if (wsRef.current.halted) return;
    turnAbort.current?.abort();
    agentAbort.current?.abort();
    setError(null);
    setWs((prev) => {
      if (prev.halted) return prev;
      const updated = pushAudit({ ...prev, halted: true }, "emergency_stop", "session", "on");
      const stopped = haltFleet(updated);
      return {
        ...stopped,
        schedules: stopped.schedules.map((job) => (job.enabled ? { ...job, enabled: false } : job)),
      };
    });
    setNotice("Emergency stop is on. Open runs were canceled and schedules were paused. Logs and memory were kept.");
    try {
      const result = await setExecutionHalt({ data: { on: true } });
      if (!result.ok) setError(result.error);
    } catch {
      setError("The server did not confirm the stop. Sends are blocked in this browser.");
    }
  }
  async function clearEmergencyStop() {
    setError(null);
    try {
      const result = await setExecutionHalt({ data: { on: false } });
      if (!result.ok) {
        setError(result.error);
        setSpeakCall((current) => ({ ...current, error: result.error }));
        return;
      }
      clearedStop.current = true;
      setWs((prev) => (prev.halted ? pushAudit({ ...prev, halted: false }, "emergency_stop", "session", "cleared by owner") : prev));
      setSpeakCall((current) => ({ ...current, error: "" }));
      setNotice("Emergency stop cleared. Schedules remain paused.");
    } catch {
      const message = "The server could not confirm the release. Emergency stop remains on.";
      setError(message);
      setSpeakCall((current) => ({ ...current, error: message }));
    }
  }
  function explain(text: string) {
    setNotice(text);
    setError(null);
  }

  async function searchConnectedNotion(query: string) {
    if (!query || wsRef.current.halted || turnOwner.current !== draftOwner) return;
    const request = ++notionSearchRequest.current;
    const epoch = notionEpoch.current;
    const current = () => request === notionSearchRequest.current && epoch === notionEpoch.current && turnOwner.current === draftOwner;
    let message: string;
    try {
      const result = await notionCommand({ data: { text: `Search my Notion for ${query}`, confirmed: false, pageId: null } });
      if (!current()) return;
      if (result.ok) {
        setNotionPages(result.pages);
        setNotionNote(result.pages.length ? "" : "Notion returned no pages.");
        const previous = notionSearchIssue(wsRef.current.audit);
        if (previous) {
          setWs((prev) => pushAudit(prev, "notion_search_recovered", "notion:search", "Search succeeded."));
          setFailure((active) => active?.auditId === previous.id ? null : active);
        }
        return;
      }
      message = result.error || "Notion search did not complete.";
    } catch {
      if (!current()) return;
      message = "Notion search could not be completed.";
    }
    setNotionPages([]);
    setNotionNote(message);
    reportFailure(message, "notion_search_failed", "notion:search", () => { void searchConnectedNotion(query); });
  }

  function clearFailure() {
    setFailure(null);
    setError(null);
  }

  function presentReportedFailure(outcome: McpReportedOutcome, auditId: string, retry: (() => void) | null) {
    const { message, action, target, kind, failureAction } = outcome;
    setWs((prev) => ({
      ...prev,
      audit: retainActivity([{ id: auditId, at: new Date().toISOString(), action, target, result: message }, ...prev.audit]),
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

  function openSavedBotChat(agentId: string, newThread = false) {
    const current = wsRef.current;
    const opened = openBotChat(current, agentId, newThread);
    if (!opened) return;
    if (opened.ws !== current) setWs(() => opened.ws);
    setActiveId(opened.chat.id);
    setChatProjectId(null);
    setView("chat");
    closeMenus();
  }

  function openBotDestination(agentId: string, target: "runs" | "scheduled") {
    setBotDestinationId(agentId);
    setView(target);
    closeMenus();
  }

  function openHumanCode() {
    handToHumanCode("", "New coding thread");
  }

  function speakStylePersonality(style: string | null): PersonalityId {
    if (style === "Unhinged") return "unhinged";
    if (style === "Storyteller") return "storyteller";
    if (style === "Supportive") return "supportive";
    if (style === "Playful") return "playful";
    if (style === "Calm") return "professional";
    return defaultPersonalityId;
  }

  function handToHumanCode(text: string, title = "Intelligence") {
    const made = createChat(ws, {
      memory: memoryChoice,
      autonomy,
      temporary,
      projectId: chatProjectId || projectChoice || null,
      personalityId: "custom",
      customPersonality: HUMAN_CODE_NOTE,
    });
    made.chat.title = title;
    setWs((prev) => pushAudit({ ...prev, chats: [made.chat, ...prev.chats] }, "create_chat", made.chat.id, "human code"));
    setActiveId(made.chat.id);
    if (text.trim()) sessionStorage.setItem("adrian-human-draft", text.trim().slice(0, 4000));
    setView("code");
    setNavOpen(false);
    setSpeakStageOpen(false);
    setNotice("Intelligence thread opened. Ask about code, or send a task to Build.");
  }

  async function sendHumanCode(id: string, text: string, image?: { dataUrl: string; name: string }) {
    const source = wsRef.current;
    const chat = source.chats.find((item) => item.id === id);
    if (!chat) {
      setNotice("That Intelligence thread is gone. Open a new one.");
      return;
    }
    setActiveId(id);
    setView("code");
    setNotice("Intelligence is answering.");
    const command = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (command === "/diff" || command === "/run" || command === "/test" || command === "/fix" || command === "/files") {
      setNotice(await humanCodeAction(id, command, text));
      return;
    }
    const safe = text.replace(/(?:^|\n)\s*[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/gi, " [secret omitted]");
    const generic = !chat.title || chat.title === "Human Code" || chat.title === "Intelligence" || chat.title === "From EVE" || chat.title === "New coding thread";
    const named = generic ? { ...chat, title: text.replace(/^\/(\S+)\s*/, "$1 ").replace(/\s+/g, " ").trim().slice(0, 48) || "Intelligence" } : chat;
    const namedSource = generic ? { ...source, chats: source.chats.map((item) => item.id === id ? named : item) } : source;
    const reply = await deliver(named, ["/explain", "/review", "/plan", "/refactor"].includes(command) ? `Coding discussion only. Do not claim a file changed. ${safe}` : safe, namedSource, false, image ? [{ dataUrl: image.dataUrl, name: image.name }] : []);
    setNotice(reply ? "Intelligence answered. File changes still go to Build." : "Intelligence did not answer. Nothing was sent to Build.");
  }

  async function humanCodeAction(id: string, command: string, text: string) {
    if (command === "/files") {
      try {
        const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "list" }) });
        const data = await response.json() as { ok?: boolean; files?: { path: string }[]; error?: string };
        const names = (data.files || []).slice(0, 200).map((file) => file.path).filter((path) => !/(^|\/)\.env($|\.)/i.test(path));
        setWs((prev) => appendHumanResult(prev, id, text, data.ok ? `Indexed ${names.length} files, capped at 200.\n${names.slice(0, 40).join("\n")}` : data.error || "Build could not list files. Discussion-only mode is still available."));
        return data.ok ? "Intelligence indexed the hosted workspace." : "Build is unavailable for files. Intelligence stayed in discussion.";
      } catch {
        setWs((prev) => appendHumanResult(prev, id, text, "Build is unavailable. Nothing was changed."));
        return "Build is unavailable. Intelligence stayed in discussion.";
      }
    }
    if (command === "/diff") {
      try {
        const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "git" }) });
        const data = await response.json() as { ok?: boolean; branch?: string; status?: string; diff?: string; notice?: string; error?: string };
        const body = data.ok ? `${data.notice || "Local Git read."}\nBranch: ${data.branch || "none"}\n${(data.status || "").slice(0, 1200)}\n${(data.diff || "").slice(0, 1800)}` : data.error || "Build could not read Git. Discussion-only mode is still available.";
        setWs((prev) => appendHumanResult(prev, id, text, body));
        return data.ok ? "Intelligence read the local diff. Nothing was committed or pushed." : "Build is unavailable for Git. Intelligence stayed in discussion.";
      } catch {
        setWs((prev) => appendHumanResult(prev, id, text, "Build is unavailable. Nothing was changed. You can still discuss the code."));
        return "Build is unavailable. Intelligence stayed in discussion.";
      }
    }
    if (command === "/test") {
      try {
        const response = await fetch("/api/mind/build/files", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "list" }) });
        const data = await response.json() as { ok?: boolean; files?: { path: string }[] };
        const tests = (data.files || []).map((file) => file.path).filter((path) => /(^|\/)(package\.json|pytest\.ini|.*\.(test|spec)\.(ts|tsx|js|jsx)|test_.*\.py|.*_test\.py)$/i.test(path));
        if (data.ok && tests.length === 0) {
          setWs((prev) => appendHumanResult(prev, id, text, "No test file or package.json is in the hosted workspace. Nothing was run. Nothing is marked passed."));
          return "No test runner is in this workspace. Nothing was marked passed.";
        }
      } catch {
        setWs((prev) => appendHumanResult(prev, id, text, "Build could not check for tests. Nothing was marked passed."));
        return "Build could not check for tests. Nothing was marked passed.";
      }
    }
    const rest = text.replace(/^\/\S+\s*/, "").trim();
    const task = command === "/test"
      ? `Run the relevant tests in the hosted workspace and report the output. Do not claim a pass unless the output says so. ${rest}`.trim()
      : command === "/fix"
        ? `Fix only the files named here. ${rest}`.trim()
        : `Do this in the hosted workspace and report what changed. ${rest || text}`.trim();
    sessionStorage.setItem(`adrian-build-draft.${draftOwner || "signed-out"}`, task.slice(0, 4000));
    sessionStorage.setItem(`adrian-human-return.${draftOwner || "signed-out"}`, id);
    if (command === "/fix" || command === "/run" || command === "/test") sessionStorage.setItem(`adrian-build-mode.${draftOwner || "signed-out"}`, "auto");
    setWs((prev) => appendHumanResult(prev, id, text, "Handed to Build. File changes happen only after you press Run build. This thread stays here."));
    setView("build");
    return "Opened Build with this Intelligence task. The thread is still saved.";
  }

  async function speakChatTurn(transcript: string, options?: { stay?: boolean }) {
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
      if (!options?.stay) setView("chat");
      setWs((prev) => pushAudit({ ...prev, chats: [made.chat, ...prev.chats] }, "create_chat", made.chat.id, "speak"));
    }
    const spokenStyle = speakStylePersonality(typeof localStorage === "undefined" ? null : localStorage.getItem("adrian-speak-style"));
    if (parseCreateBot(transcript)) {
      const made = createBotFromSpeech(source, transcript);
      if (!made.ok) return { ok: false as const, error: made.error };
      setWs(made.ws);
      setNotice(made.reply);
      if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: transcript, reply: made.reply, error: "" }));
      return { ok: true as const, text: made.reply };
    }
    const reply = await deliver({ ...chat, personalityId: spokenStyle }, transcript, source, false, [], { accessNotes: chat.memory === "on" && !chat.temporary ? eveAccessNotes(workspaceForChat(source, chat)) : [] });
    if (!reply) return { ok: false as const, error: "The chat turn failed. Nothing was spoken." };
    return { ok: true as const, text: reply };
  }

  async function speak(text: string, messageId = "", voiceId = voiceChoiceRef.current, replay?: SpeakRetryParams) {
    if (currentFreeOnly.current) { setError("Free-only mode is on. Cloud voice requires a billable provider. Browser dictation is still available when supported."); return { ok: false as const, error: "Free-only mode is on. Cloud voice requires a billable provider. Browser dictation is still available when supported." }; }
    if (!text && !replay && voiceModeRef.current === "orchestrator") {
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
    let speechError = "";
    let spokeProvider = "";
    await runMountedSpeak({
      text,
      messageId,
      voiceId,
      replay,
      isCurrent: () => generation === speakGenRef.current && !abort.signal.aborted,
      deps: {
        capture: () => captureSpeakUtterance({ maxMs: 6000, signal: abort.signal }),
        transcribe: async (audioBase64, mime) => {
          const detected = await detectWithHandy(audioBase64);
          if (detected.ok) {
            setNotice("Handy Whisper Flow detected this. Speak is the call.");
            return { ok: true, text: detected.text, provider: "handy" };
          }
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
            body: JSON.stringify({ audioBase64, mime, freeOnly: currentFreeOnly.current, filename: sanitizeAudioFilename("speak", mime) }),
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
          const spoken = await speakText({ data: { text: reply, voiceId: voice, freeOnly: currentFreeOnly.current } });
          if (spoken && typeof spoken === "object" && "ok" in spoken && spoken.ok) {
            const audio = "audio" in spoken && typeof spoken.audio === "string" ? spoken.audio.trim() : "";
            if (!audio) return { ok: false, error: "The provider returned no audio. Nothing was played." };
            if ("provider" in spoken && typeof spoken.provider === "string" && spoken.provider) spokeProvider = spoken.provider;
          }
          return spoken;
        },
        play: async (audio) => {
          window.speechSynthesis?.cancel();
          voiceSession.current?.interruptPlayback();
          const pace = localStorage.getItem("adrian-speak-rate");
          const volume = Number(localStorage.getItem("adrian-speak-volume") ?? "100");
          await sharedAudioOutput.playMpegBase64(audio, {
            rate: pace === "slow" ? 0.85 : pace === "brisk" ? 1.15 : 1,
            volume: Number.isFinite(volume) ? volume / 100 : 1,
          });
          setNotice(spokeProvider ? `${spokeProvider} spoke this reply.` : "The reply was spoken.");
        },
      },
      reportFailure: (message, action, target, retry) => {
        speechFailed = true;
        speechError = message;
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
    return speechFailed ? { ok: false as const, error: speechError || "The reply was not spoken." } : { ok: true as const };
  }

  useEffect(() => () => {
    if (voiceSession.current || listenMintAbortRef.current) stopVoiceSession();
    auxiliaryHistory.current = null;
  }, [voiceScope]);

  function makeCallHistory() {
    return createCallHistory(active?.id ?? null, () => createChat(wsRef.current, {
      memory: memoryChoice, autonomy, temporary, projectId: chatProjectId || projectChoice || null,
      personalityId: defaultPersonalityId,
    }).chat);
  }

  function appendLiveTranscript(role: Msg["role"], text: string, record?: CallHistory, model = "grok-voice-latest", provider = "xai") {
    const content = text.trim();
    if (!content || currentVoiceScope.current !== voiceScope || wsRef.current.halted) return;
    if (!record) {
      if (auxiliaryHistory.current?.scope !== voiceScope) auxiliaryHistory.current = { scope: voiceScope, record: makeCallHistory() };
      record = auxiliaryHistory.current.record;
    }
    if (role === "assistant") noteSpokenText(content);
    const message: Msg = { id: crypto.randomUUID(), at: new Date().toISOString(), role, content };
    if (role === "assistant") Object.assign(message, { model, provider });
    const append = record(message);
    setWs((prev) => {
      if (currentVoiceScope.current !== voiceScope || prev.halted) return prev;
      const next = append(prev);
      if (next === prev) return prev;
      const thread = next.chats.find((chat) => chat.messages.at(-1)?.id === message.id)!;
      return pushAudit(next, "message_sent", thread.id, `live-voice-${role}`);
    });
  }

  function stopVoiceSession() {
    window.clearTimeout(reconnectTimer.current);
    endFlight(flightGateRef.current, flightGateRef.current.generation);
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

  function setVoiceMicMuted(desired: boolean) {
    const decided = nextMuteState(voiceMutedRef.current, desired);
    if (!decided.changed) return;
    voiceMutedRef.current = decided.muted;
    setVoiceMuted(decided.muted);
    voiceSession.current?.setMuted(decided.muted);
    const message = decided.muted ? "Microphone muted. Listening session stays open." : "Microphone unmuted.";
    setNotice(message);
    if (overlayOpenRef.current) setOverlayNotice(message);
  }

  useEffect(() => {
    if (ws.halted) stopVoiceSession();
  }, [ws.halted]);

  function toggleVoiceMute() {
    setVoiceMicMuted(toggleMute(voiceMutedRef.current));
  }

  async function handleVoiceTranscript(transcript: string, record: CallHistory, mode: VoiceRoutingMode, isCurrent: () => boolean) {
    if (!isCurrent()) return;
    if (!shouldAcceptTranscript(transcriptDedupeRef.current, transcript)) return;
    const sanitized = sanitizeVoiceTranscript(transcript);
    if (!sanitized.ok) {
      setNotice(sanitized.error);
      return;
    }
    const text = sanitized.text;
    if (parseCreateBot(text)) {
      const made = createBotFromSpeech(wsRef.current, text);
      if (!made.ok) {
        setNotice(made.error);
        if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: text, error: made.error }));
        return;
      }
      if (spokenPcCommand(text)) {
        const acted = await fetch("/api/mind/pc/status", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, destination: "current-device" }) }).then((response) => response.json()).catch(() => null) as { output?: string; error?: string } | null;
        if (!isCurrent()) return;
        const extra = acted?.output || acted?.error || "";
        made.reply = extra ? `${made.reply} ${extra}` : made.reply;
      }
      setWs(made.ws);
      setNotice(made.reply);
      if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: text, reply: made.reply, error: "" }));
      if (mode === "orchestrator") await speak(made.reply);
      else speakOnOpenSession(made.reply);
      return;
    }
    appendLiveTranscript("user", text, record);
    if (mode === "direct") return;
    const conducted = await runOllamaConductor(text, {
      baseUrl: localStorage.getItem("amcos.ollama.base") || undefined,
      model: localStorage.getItem("amcos.ollama.model") || undefined,
    });
    if (!isCurrent()) return;
    if (!conducted.ok) {
      setError(conducted.error);
      if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, error: conducted.error }));
      if (overlayOpenRef.current) setOverlayError(conducted.error);
      return;
    }
    appendLiveTranscript("assistant", conducted.text, record, conducted.model, "ollama");
    if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, reply: conducted.text }));
    await speak(conducted.text);
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
    if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, error: shown }));
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
    if (!session?.isOpen) return;
    const decision = enqueueSpeak(speakQueueRef.current, text);
    if (decision === "start") session.speakText(text);
  }

  function commitDictation(action: DictationAction, announce = true) {
    const prev = { ...dictationRef.current, draft: draftRef.current };
    let next = reduceDictation(prev, action);
    if (action.type === "stop_inserted") {
      const base = dictationBaseRef.current ?? draftRef.current;
      next = { ...next, draft: appendDictationText(base, action.text) };
      dictationBaseRef.current = null;
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
      void startServerDictation();
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
        const next = appendDictationText(dictationBaseRef.current ?? "", dictationBufferRef.current);
        if (next !== draftRef.current) {
          draftRef.current = next;
          setDraft(next);
        }
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
      if (code === "service-not-allowed" || code === "network" || code === "audio-capture") {
        dictationRef.current = { ...dictationRef.current, phase: "idle" };
        setDictation((current) => ({ ...current, phase: "idle" }));
        void startServerDictation();
        return;
      }
      commitDictation({
        type: "stop_error",
        message: code === "not-allowed"
          ? "Microphone permission was denied. Nothing was inserted. Speak was not opened."
          : "Browser speech failed. Nothing was inserted. Speak was not opened.",
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
      dictationBaseRef.current = draftRef.current;
      setNotice("Listening. Words appear in the field as they are recognised. Send stays separate.");
    } catch {
      dictationRecRef.current = null;
      setDictationLevel(0);
      dictationRef.current = { ...dictationRef.current, phase: "idle" };
      setDictation((current) => ({ ...current, phase: "idle" }));
      void startServerDictation();
    }
  }

  function onDictationMic() {
    if (serverDictationRef.current) {
      void finishServerDictation();
      return;
    }
    if (dictationRecRef.current || dictationRef.current.phase === "recording") {
      stopBrowserDictation();
      return;
    }
    startBrowserDictation();
  }

  async function startServerDictation() {
    if (currentFreeOnly.current) { setError("This browser needs cloud transcription. Free-only mode keeps it off."); return; }
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
      dictationBaseRef.current = draftRef.current;
      setNotice("This browser has no live speech recognition. Speak, then press Mic again. Words are inserted only after transcription. Nothing is sent.");
    } catch {
      serverDictationRef.current = null;
      commitDictation({
        type: "stop_error",
        message: "This browser could not record. Nothing was transcribed.",
      });
      setNotice("This browser could not record. Nothing was transcribed. Nothing was sent. Speak was not opened.");
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
        body: JSON.stringify({ audioBase64, mime, freeOnly: currentFreeOnly.current, filename: sanitizeAudioFilename("dictation", mime) }),
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

  function clearOverlayFlag() {
    overlayOpenRef.current = false;
    setVoiceOverlayOpen(false);
    setOverlayPhase("idle");
    setOverlayError(null);
    setOverlayNotice(null);
  }

  function openSpeakStage() {
    closeMenus();
    clearOverlayFlag();
    setSpeakCall({ heard: "", reply: "", error: "" });
    setSpeakStageOpen(true);
  }

  function pickModule(item: ModuleSuggestion) {
    if (item.action === "speak") {
      openSpeakStage();
      return;
    }
    if (item.action === "dictate") {
      onDictationMic();
      return;
    }
    if (item.action === "model" && item.tier && (MODEL_TIERS as readonly string[]).includes(item.tier)) {
      chooseModelTier(item.tier as ModelTier);
      setNotice(`Model set to ${item.tier}. No call was started.`);
      return;
    }
    const views = new Set<string>([
      "command", "intelligence", "chat", "projects", "memory", "agents", "runs", "research", "files",
      "connected", "tools", "build", "code", "scheduled", "integrations", "activity", "help", "skills", "settings",
      "voice",
    ]);
    if (item.action === "view" && item.view && views.has(item.view)) {
      setView(item.view as View);
      setNavOpen(false);
    }
  }

  function closeSpeakStage() {
    speakStageOpenRef.current = false;
    setSpeakStageOpen(false);
    if (!overlayOpenRef.current) void listen({ mode: "stop" });
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
    setSpeakStageOpen(false);
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
      if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, error: LIVE_VOICE_BUSY_MESSAGE }));
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
    if (action === "start" && currentFreeOnly.current) {
      const message = "Free-only mode is on. Cloud voice requires a billable provider. Browser dictation is still available when supported.";
      setSpeakCall((current) => ({ ...current, error: message }));
      setOverlayError(message);
      setError(message);
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

    const mintAbort = new AbortController();
    listenMintAbortRef.current = mintAbort;
    const markCanceled = () => {
      if (listenMintAbortRef.current !== mintAbort) return;
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
      if (mintAbort.signal.aborted) return;
      setNotice("Minting voice session… (press mic or release Space to cancel)");

      let secret: Awaited<ReturnType<typeof createVoiceClientSecret>>;
      try {
        secret = await withSessionTimeout(() => createVoiceClientSecret({ data: { freeOnly: currentFreeOnly.current } }), undefined, mintAbort.signal);
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
            secret = await withSessionTimeout(() => createVoiceClientSecret({ data: { freeOnly: currentFreeOnly.current } }), undefined, mintAbort.signal);
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
      const sessionMode = getVoiceMode();
      const voiceBuilt = voiceSessionInstructions({
        mode: sessionMode,
        personalityId: speakStylePersonality(typeof localStorage === "undefined" ? null : localStorage.getItem("adrian-speak-style")),
        customPersonality: voiceChat?.customPersonality ?? "",
        characterId: readStoredCharacterId(typeof localStorage === "undefined" ? null : localStorage),
      });
      const record = makeCallHistory();
      const isCurrent = (): boolean => voiceSession.current === session && session.isOpen && !wsRef.current.halted && currentVoiceScope.current === voiceScope;
      let turnNumber = 0;
      const session: RealtimeVoiceSession = new RealtimeVoiceSession(
        {
          onTranscript: (text) => {
            if (!isCurrent()) return;
            const turn = ++turnNumber;
            setVoiceLiveTranscript(clampLiveTranscript(text));
            if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: text, error: "" }));
            void handleVoiceTranscript(text, record, sessionMode, () => isCurrent() && turnNumber === turn);
          },
          onAssistantTranscript: (text) => {
            if (!isCurrent() || sessionMode === "orchestrator") return;
            appendLiveTranscript("assistant", text, record);
            if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, reply: text, error: "" }));
          },
          onPartialTranscript: (text) => {
            if (!isCurrent()) return;
            setVoiceLiveTranscript(clampLiveTranscript(text));
          },
          onSpeechStarted: () => {
            if (!isCurrent()) return;
            ++turnNumber;
            if (overlayOpenRef.current) {
              pushBarge({ type: "speech_started" });
              return;
            }
            interruptSpeakPlayback();
          },
          onError: (message) => {
            setAvatarPresence("error");
            const shown = message || "Voice realtime error.";
            setError(shown);
            if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, error: shown }));
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
            setVoiceListening(Boolean(voiceSession.current?.isCapturing));
            if (status === "processing") setAvatarPresence("processing");
            if (status === "speaking") {
              setSpeaking(true);
              if (readAvatarSession().utterance) setAvatarPresence("speaking");
            }
            if (status === "listening") setAvatarPresence("listening");
            if (speakStageOpenRef.current && status === "listening") setSpeakCall((current) => ({ ...current, error: "" }));
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
            if (speakStageOpenRef.current) {
              setSpeakCall((current) => ({ ...current, error: VOICE_CONNECTION_DROPPED }));
              return;
            }
            if (voiceReconnectRef.current < 1) {
              voiceReconnectRef.current += 1;
              setNotice("Voice connection dropped. Reconnecting once…");
              reconnectTimer.current = window.setTimeout(() => {
                void listenRef.current({ mode: "start" });
              }, 400);
            }
          },
        },
        sharedAudioOutput,
        undefined,
        { voice: voiceChoiceRef.current, instructions: voiceBuilt.instructions, transcriptOnly: voiceBuilt.silent,
          voiceIsolation: loadVoiceSettings(localStorage).activation === "isolation",
        },
      );
      voiceSession.current = session;
      await session.connect(secret.value);
      if (mintAbort.signal.aborted) {
        session.close();
        if (voiceSession.current === session) voiceSession.current = null;
        markCanceled();
        return;
      }
      publishConnectStage("requesting_mic");
      const startMuted = voiceMutedRef.current || (speakStageOpenRef.current && loadVoiceSettings(localStorage).activation === "push_to_talk");
      session.setMuted(startMuted);
      setVoiceMicMuted(startMuted);
      await session.startCapture();
      if (mintAbort.signal.aborted || voiceSession.current !== session || !session.isCapturing) return;
      publishConnectStage("listening");
      setVoiceListening(true);
      voiceReconnectRef.current = 0;
      listenMintAbortRef.current = null;
      const modeLabel = voiceModeRef.current === "orchestrator" ? "Orchestrator" : "Direct";
      setNotice(`Realtime voice listening (${modeLabel}). Hold Space or press mic to stop.`);
      if (overlayOpenRef.current) setOverlayNotice(`Realtime voice listening (${modeLabel}).`);
    } catch (caught) {
      if (mintAbort.signal.aborted || listenMintAbortRef.current !== mintAbort) return;
      stopVoiceSession();
      const normalized = normalizeVoiceConnectError(caught);
      const mic = formatMicCaptureError(caught);
      const message = /sign in/i.test(normalized) ? normalized : mic || normalized || formatVoiceClientError(caught);
      const stage = connectStateRef.current.stage === "idle" ? "connecting" : connectStateRef.current.stage;
      const failed = failStage(stage, message);
      connectStateRef.current = failed;
      setError(message);
      if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, error: message }));
      if (overlayOpenRef.current) {
        setOverlayPhase("error");
        setOverlayError(failed.error);
      }
    } finally {
      endFlight(flightGateRef.current, flight.generation);
      if (listenMintAbortRef.current === mintAbort && !voiceSession.current?.isOpen) listenMintAbortRef.current = null;
      if (flightGateRef.current.generation === flight.generation && !voiceSession.current?.isOpen) {
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
    let result: Awaited<ReturnType<typeof reaInspect>>;
    try {
      result = await reaInspect({ data: file });
    } catch {
      setReaReport(`Could not inspect ${file.name}. Check your connection and try again.`);
      return;
    } finally {
      setReaBusy(false);
    }
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

  const headerState = ws.halted ? "Stopped" : grok === "Configured" ? "Grok ready" : grok;
  const headerDetail = ws.halted
    ? "Emergency stop is on. New actions are blocked. Open Settings to review it."
    : grok === "Configured"
      ? "Grok is configured on the server. This does not verify a live reply."
      : grok === "Setup required"
        ? "No Grok server key is configured. Open Connected to review provider setup."
        : grok === "Refused"
          ? "The server refused the current Grok configuration. Open Connected for the recorded status."
          : grok === "Checking"
            ? "Checking the service configuration."
            : "The status check did not finish. Open Connected to see what is known.";
  const headerTone = ws.halted || grok === "Refused" || grok === "Status unavailable" ? "text-danger border-danger/40" : grok === "Setup required" ? "text-warn border-warn/40" : "text-muted border-line";
  const memories = ws.memories.filter((item) => {
    if (!showArchived && item.archived) return false;
    if (memoryTab === "chat" && item.scope !== "chat") return false;
    if (memoryTab === "mine" && item.scope !== "global") return false;
    if (memoryTab === "project" && item.scope !== "project") return false;
    if (memoryTab === "project" && memoryProject && item.projectId !== memoryProject) return false;
    return item.text.toLowerCase().includes(memoryQuery.trim().toLowerCase());
  });
  const memoryBytes = ws.memories.reduce((sum, item) => sum + new TextEncoder().encode(item.text).length, 0);
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
    <div id="mind-workspace" className="shell flex h-dvh flex-col bg-bg text-fg md:flex-row" data-view={view} data-search={paletteOpen ? "open" : "closed"}>
      <MenuMotion />
      {navOpen ? <button type="button" className="fixed inset-0 md:hidden" aria-label="Close menu" style={{ zIndex: 150, background: "transparent" }} onClick={() => setNavOpen(false)} /> : null}
      <aside ref={(node) => { navDrawerRef.current = node; pinRailFrame(node); }} onMouseDown={closeNavFromBackdrop} role={navOpen ? "dialog" : undefined} aria-modal={navOpen ? true : undefined} aria-label={navOpen ? "Workspace navigation" : undefined} className={`rail gpt-rail ${navOpen ? "nav-drawer-open flex" : "hidden"} fixed inset-0 z-40 w-full flex-col overflow-hidden md:static md:flex md:h-dvh ${railCollapsed ? "md:w-[4.5rem]" : "md:w-72"} md:shrink-0`}>
        <div className="gpt-rail-head flex items-center gap-3 px-4 py-4">
          {!railCollapsed && (
            <p className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-semibold tracking-tight">
              <img className="service-mark adrian-mark" src="/brand/logo-mark.jpg" alt="" width={32} height={32} />
              <span className="truncate">Adrian</span>
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
            <Search size={20} strokeWidth={1.75} />
          </button>
          <button ref={navCloseRef} type="button" className="grid size-11 place-items-center rounded-full bg-white/8 md:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)}>
            <span className="icon-x" aria-hidden="true" />
          </button>
          <button type="button" className="hidden size-11 place-items-center rounded-full bg-white/8 md:grid" aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setRailCollapsed((value) => !value)}>
            <PanelLeft className="size-4" />
          </button>
        </div>
        <nav ref={pinRailScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="workspace-nav" style={{ overflowY: "auto", minHeight: 0 }}>
          <button
            type="button"
            data-testid="nav-route-dashboard"
            title="Dashboard"
            aria-label="Dashboard"
            aria-current={view === "dashboard" ? "page" : undefined}
            className={`nav-item mb-4 flex min-h-11 w-full items-center gap-3 rounded-2xl px-3 text-sm font-medium ${railCollapsed ? "justify-center px-0" : ""} ${view === "dashboard" ? "nav-item-active" : "text-muted"}`}
            onClick={() => { setView("dashboard"); setNavOpen(false); closeMenus(); }}
          >
            <LayoutDashboard size={20} className="shrink-0" aria-hidden="true" />
            {!railCollapsed && "Dashboard"}
          </button>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              {!railCollapsed && <p ref={showRailLabel} className="meta-label px-3 pb-2">{group.label}</p>}
              <div className="space-y-1">
                {group.items.map((item, itemIndex) => {
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
                      <img className="service-mark size-5 shrink-0 rounded-md object-cover" src={navMark(item.id)} alt="" width={22} height={22} />
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
            <img className="service-mark size-5 rounded-md object-cover" src="/brand/marks/explore.png" alt="" width={22} height={22} />
            {!railCollapsed && "Explore"}
          </Link>
          <Link
            to="/research"
            data-testid="nav-route-research"
            className={`nav-item flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted ${railCollapsed ? "justify-center" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <img className="service-mark size-5 rounded-md object-cover" src="/brand/marks/research.png" alt="" width={22} height={22} />
            {!railCollapsed && "Research"}
          </Link>
          <Link
            to="/social"
            data-testid="nav-route-social"
            aria-label="Social"
            className={`nav-item flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted ${railCollapsed ? "justify-center" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <img className="service-mark size-5 rounded-md object-cover" src="/apps/social/assets/mark.jpg" alt="" width={22} height={22} />
            {!railCollapsed && "Social"}
          </Link>
          <Link
            to="/gpt-wrapper"
            data-testid="nav-route-gpt-wrapper"
            aria-label="GPT wrapper"
            className={`nav-item flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted ${railCollapsed ? "justify-center" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <img className="service-mark size-5 rounded-md object-cover" src="/brand/marks/gpt-wrapper.svg" alt="" width={22} height={22} />
            {!railCollapsed && "GPT wrapper"}
          </Link>
          {!railCollapsed && (
            <>
            <button
              type="button"
              className="nav-item mt-3 flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm font-medium text-muted"
              aria-expanded={navMoreOpen}
              aria-haspopup="menu"
              onClick={(event) => {
                const next = !navMoreOpen;
                closeMenus("nav");
                setNavMoreAnchor(event.currentTarget.getBoundingClientRect());
                setNavMoreOpen(next);
              }}
            >
              More
            </button>
            {navMoreHold ? (
              <AnchoredCard anchor={navMoreAnchor} label="More" onClose={() => setNavMoreOpen(false)} testId="nav-more-panel" width={640} align="start" phase={navMoreOpen ? "open" : "close"}>
              <MenuShelf width="100%" testId="nav-more-shelf">
                {([
                  ["People", ["intelligence", "agents", "voice"]],
                  ["Work", ["tools", "skills", "runs"]],
                  ["Record", ["memory", "activity", "help"]],
                ] as const).map(([label, ids]) => (
                  <MenuCluster key={label} label={label}>
                    {ids.map((id) => {
                      const item = MORE_NAV.find((entry) => entry.id === id);
                      if (!item) return null;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`nav-item flex min-h-11 items-center gap-2 rounded-2xl px-3 text-sm font-medium ${view === item.id ? "nav-item-active" : "text-muted"}`}
                          style={menuChip}
                          onClick={() => { setView(item.id); setNavMoreOpen(false); setNavOpen(false); }}
                          data-testid={item.id === "voice" ? "nav-voice-clone" : undefined}
                        >
                          <span className="icon-tile" aria-hidden="true"><item.icon size={20} strokeWidth={1.75} /></span>
                          {item.label}
                        </button>
                      );
                    })}
                  </MenuCluster>
                ))}
              </MenuShelf>
              </AnchoredCard>
            ) : null}
            </>
          )}
          {!railCollapsed && <div className="mx-3 my-3 border-t border-white/10" />}
          {!railCollapsed && ws.chats.length > 0 && (
            <div className="mb-4" data-testid="sidebar-recent">
              <p className="px-3 pb-2 text-xs font-medium text-muted">Recent conversations</p>
              <ConversationSections
                chats={ws.chats}
                activeId={activeId}
                titleFor={shownChatTitle}
                projects={ws.projects.map((project) => ({ id: project.id, name: project.name }))}
                pinnedIds={ws.pins.filter((pin) => pin.kind === "chat").map((pin) => pin.ref)}
                scheduledChatIds={ws.schedules.flatMap((job) => job.chatId ? [job.chatId] : [])}
                onOpen={(id) => {
                  setActiveId(id);
                  setView(isIntelligenceThread(ws.chats.find((chat) => chat.id === id)?.customPersonality) ? "code" : "chat");
                  setNavOpen(false);
                }}
                onAction={runConversationAction}
                extras={(ids) => (ids.length === 1 && ids[0] === activeId ? [{ label: "Download text transcript", onPick: () => exportActive(true) }, { label: "Download transcript JSON with attachments", onPick: () => exportActive() }] : [])}
              />
            </div>
          )}
          {ws.pins.length > 0 && !railCollapsed && (
            <div className="mb-3">
              <p className="px-3 pb-1 text-xs font-medium text-muted">Pinned</p>
              {ws.pins.map((pin) => {
                const label =
                  pin.kind === "agent"
                    ? ws.agents.find((agent) => agent.id === pin.ref && !agent.archived)?.name
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
                        setView(isIntelligenceThread(ws.chats.find((chat) => chat.id === pin.ref)?.customPersonality) ? "code" : "chat");
                      } else if (pin.kind === "agent" || pin.kind === "project") {
                        setCardFocus({ id: `${pin.kind === "agent" ? "bot" : "project"}-${pin.ref}` });
                        setView(pin.kind === "agent" ? "agents" : "projects");
                      }
                      else { setOpenFileId(pin.ref); setLibraryProjectId(null); setLibraryBand("preview"); setView("files"); }
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
            <Settings className="size-4" />
          </button>
        </div>
      </aside>

      <main ref={pinMainColumn} className="main-stage page-enter flex min-h-0 min-w-0 flex-1 flex-col" inert={navOpen}>
        <h1 className="sr-only">Adrian’s Mind OS</h1>
        <header className="topbar flex flex-nowrap items-center gap-2 px-3 py-3 md:gap-3 md:px-5" ref={(node) => { if (view !== "chat" && view !== "command") node?.style.setProperty("overflow", "visible", "important"); else node?.style.removeProperty("overflow"); }}>
         <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel border border-line md:hidden" aria-label="Open menu" onClick={openNav}>
           <Menu className="size-4" />
         </button>
          <div className="surface-switch relative shrink-0">
            <button
              type="button"
              className="surface-switch__button shrink-0 whitespace-nowrap"
              aria-expanded={surfaceMenu}
              aria-haspopup="menu"
              aria-label={`Current surface: ${TITLES[view] ?? "Chat"}. Switch between Chat, Build, and Intelligence Layer`}
              onClick={(event) => {
                const next = !surfaceMenu;
                closeMenus("surface");
                setSurfaceAnchor(event.currentTarget.getBoundingClientRect());
                setSurfaceMenu(next);
              }}
            >
              <img className="adrian-mark" src="/brand/logo-mark.jpg" alt="" width={28} height={28} />
              <span>{TITLES[view] ?? "Chat"}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {surfaceMenu ? (
              <AnchoredCard anchor={surfaceAnchor} label="Places" onClose={() => setSurfaceMenu(false)} testId="surface-menu" width={440} align="start">
                <MenuShelf width="100%" testId="places-shelf">
                  <MenuCluster label="Talk">
                    {([
                      ["command", "Chat", "Conversation"],
                      ["code", "Intelligence", "Coding conversation"],
                    ] as const).map(([id, label, detail]) => (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        className={`flex min-h-11 flex-col items-start justify-center rounded-2xl px-3 text-left ${view === id || (id === "command" && view === "chat") ? "bg-white/10" : ""}`}
                        style={menuChip}
                        onClick={() => { setView(id); setSurfaceMenu(false); setNavOpen(false); }}
                      >
                        <span className="text-sm">{label}</span>
                        <span className="text-xs text-muted">{detail}</span>
                      </button>
                    ))}
                  </MenuCluster>
                  <MenuCluster label="Make">
                    {([
                      ["build", "Build", "Coding workspace"],
                      ["intelligence", "Intelligence Layer", "Emma appears only here"],
                    ] as const).map(([id, label, detail]) => (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        className={`flex min-h-11 flex-col items-start justify-center rounded-2xl px-3 text-left ${view === id ? "bg-white/10" : ""}`}
                        style={menuChip}
                        onClick={() => { setView(id); setSurfaceMenu(false); setNavOpen(false); }}
                      >
                        <span className="text-sm">{label}</span>
                        <span className="text-xs text-muted">{detail}</span>
                      </button>
                    ))}
                  </MenuCluster>
                </MenuShelf>
              </AnchoredCard>
            ) : null}
          </div>
          <div className="command-search relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPaletteIndex(0);
                closeMenus("palette");
                setPaletteOpen(true);
              }}
              onFocus={() => {
                closeMenus("palette");
                setPaletteOpen(true);
              }}
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
              <div id="command-palette" ref={finishMenu} className="command-palette floating-menu absolute z-30 mt-2 w-full" role="listbox" aria-label="Search results">
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Results</p>
                {hits.length === 0 && <p className="px-3 py-3 text-sm text-muted">No matches.</p>}
                {hits.map((hit, index) => {
                  const kind = hit.meta === "Chat" || hit.meta === "Intelligence" ? "chat" : hit.meta === "Agent" ? "agent" : hit.meta === "Project" ? "project" : hit.meta === "File" ? "file" : null;
                  const active = hits.length > 0 && index === Math.min(Math.max(paletteIndex, 0), hits.length - 1);
                  return (
                    <div key={hit.key}>
                      <button
                        type="button"
                        id={`palette-hit-${hit.key}`}
                        role="option"
                        aria-selected={active}
                        className={`palette-option flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-panel px-2 text-left text-sm${active ? " palette-option-active" : ""}`}
                        onMouseEnter={() => setPaletteIndex(index)}
                        onPointerDown={(event) => {
                          if (!kind || !hit.ref) return;
                          const button = event.currentTarget;
                          button.dataset.held = "0";
                          const timer = window.setTimeout(() => {
                            button.dataset.held = "1";
                            const before = wsRef.current;
                            const after = togglePin(before, kind, hit.ref);
                            setWs(after);
                            setNotice(after === before ? `Pin limit reached. ${hit.label} was not added.` : after.pins.some((pin) => pin.kind === kind && pin.ref === hit.ref) ? `Pinned ${hit.label}.` : `Unpinned ${hit.label}.`);
                          }, 550);
                          event.currentTarget.dataset.hold = String(timer);
                        }}
                        onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                        onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                        onPointerCancel={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                        onClick={(event) => {
                          if (event.currentTarget.dataset.held === "1") {
                            event.currentTarget.dataset.held = "0";
                            return;
                          }
                          openPaletteHit(hit);
                        }}
                      >
                        <span className="min-w-0 truncate">{hit.label}{hit.excerpt && <small className="block truncate text-muted">{hit.excerpt}</small>}</span>
                        <span className="text-xs text-muted">{hit.meta}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="surface-switch relative shrink-0" data-testid="header-controls">
            <button
              type="button"
              className="surface-switch__button shrink-0 whitespace-nowrap"
              ref={controlsTrigger}
              aria-expanded={controlsOpen}
              aria-haspopup="dialog"
              aria-controls={controlsOpen ? "controls-menu" : undefined}
              aria-label="Open controls"
              onClick={() => {
                const next = !controlsOpen;
                closeMenus("controls");
                setControlsOpen(next);
              }}
            >
              <span>Controls</span>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {view === "chat" ? (
              <button
                type="button"
                className="surface-switch__button shrink-0 whitespace-nowrap"
                data-testid="open-chat-settings"
                ref={chatSettingsTrigger}
                aria-label="Chat settings"
                aria-controls="thread-chat-settings"
                aria-expanded={chatSettingsOpen}
                onClick={() => setChatSettingsOpen((open) => !open)}
              >
                <span>Chat settings</span>
                <ChevronDown className="chat-settings-chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
                <Settings className="chat-settings-icon" size={17} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
            {controlsOpen ? (
              <AnchoredCard anchor={null} trigger={controlsTrigger} label="Controls" onClose={() => setControlsOpen(false)} testId="controls-menu" width={640} align="start">
                <div className="controls-shelf" data-testid="controls-shelf">
                <MenuCluster label="Active model" wide>
                  <button
                    type="button"
                    className="flex min-h-11 items-center justify-between rounded-2xl px-3 text-left text-sm"
                    style={menuChip}
                    aria-expanded={modelRowsOpen}
                    onClick={() => setModelRowsOpen((value) => !value)}
                  >
                    <span className="min-w-0 break-words">{controlsModelLabel}</span>
                    <span aria-hidden="true">{modelRowsOpen ? "‹" : "›"}</span>
                  </button>
                  {modelRowsOpen && effectiveProvider !== "grok" ? (
                    <ProviderPicker name="control-model" choices={providerOptions} choice={effectiveProvider} onChoose={selectProviderInChat} logicRoutes={logicRoutes} />
                  ) : modelRowsOpen ? (
                    <ModelTierChip
                      presentation="rows"
                      tier={modelTier}
                      onChoose={chooseModelTier}
                      grokModel={grokModel}
                      onChooseGrokModel={(model) => {
                        selectProviderInChat("grok");
                        setGrokModel(model);
                      }}
                      lastResolved={lastResolvedTier}
                      lastModel={lastModelUsed}
                      logicRoute={logicRoute}
                      logicRoutes={logicRoutes}
                      onChooseLogic={selectProviderInChat}
                    />
                  ) : null}
                </MenuCluster>
                <MenuCluster label="Add a service">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-11 flex-col items-start justify-center rounded-2xl px-3 text-left"
                    style={menuChip}
                    onClick={() => { setView("connected"); setControlsOpen(false); setNavOpen(false); }}
                  >
                    <span className="text-sm">Connect a new service</span>
                    <span className="text-xs text-muted">This does not change the module in use</span>
                  </button>
                </MenuCluster>
                <MenuCluster label="Use a module" wide>
                  {consultModules.filter((item) => item.connected).length === 0 ? (
                    <p className="px-3 text-xs text-muted">No model module is configured.</p>
                  ) : consultModules.filter((item) => item.connected).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={providerChoice === item.id}
                      data-testid={`control-module-${item.id}`}
                      className="flex min-h-11 items-center justify-between rounded-2xl px-3 text-left text-sm"
                      style={menuChip}
                      onClick={() => selectProviderInChat(item.id)}
                    >
                      <span className="min-w-0 break-words">{item.label}</span>
                      <span className="text-xs text-muted">{providerChoice === item.id ? "Selected" : "Configured"}</span>
                    </button>
                  ))}
                </MenuCluster>
                <MenuCluster label="Work">
                  <button
                    type="button"
                    role="menuitem"
                    aria-pressed={composerEffort === "orchestrator"}
                    className="flex min-h-11 items-center justify-between rounded-2xl px-3 text-left text-sm"
                    style={menuChip}
                    onClick={() => chooseComposerEffort(composerEffort === "orchestrator" ? "auto" : "orchestrator")}
                  >
                    <span>Orchestrator</span>
                    <span className="text-xs text-muted">{composerEffort === "orchestrator" ? "On" : "Off"}</span>
                  </button>
                  {composerEffort === "orchestrator" ? (
                    <div className="flex w-full flex-wrap gap-1" data-testid="orchestrator-models">
                      {consultModules.filter((item) => item.connected).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          data-testid="consult-model"
                          aria-pressed={consultModel === item.id}
                          className="flex min-h-11 items-center justify-between rounded-2xl px-3 text-left text-sm"
                          style={menuChip}
                          onClick={() => chooseConsultModel(item.id)}
                        >
                          <span className="min-w-0 break-words">{item.label}</span>
                          <span className="text-xs text-muted">Ready</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </MenuCluster>
                <MenuCluster label="Share">
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-11 flex-col items-start justify-center rounded-2xl px-3 text-left"
                    style={menuChip}
                    onClick={() => {
                      const search = writeShareSearch(window.location.search, shareWriteForView(view, {
                        chat: activeId,
                        project: shareProjectId,
                        file: openFileId,
                        bot: shareBotId,
                      }), Object.keys(TITLES));
                      const url = `${window.location.origin}${window.location.pathname}${search}${window.location.hash}`;
                      void navigator.clipboard?.writeText(url).then(
                        () => setNotice("Link copied. It opens this item on a device that already has it."),
                        () => setNotice("Clipboard copy was blocked. The address bar has the link."),
                      );
                      setControlsOpen(false);
                    }}
                  >
                    <span className="text-sm">Copy link</span>
                    <span className="text-xs text-muted">Share this page</span>
                  </button>
                </MenuCluster>
                <MenuCluster label="Connection">
                  <p className="flex min-h-11 flex-col justify-center rounded-2xl px-3 text-left" style={menuChip} aria-label="Voice route Direct">
                    <span className="text-sm">Direct</span>
                    <span className="text-xs text-muted">Voice route</span>
                  </p>
                </MenuCluster>
                <MenuCluster label="Install" wide>
                  <a role="menuitem" className="flex min-h-11 items-center rounded-2xl px-3 text-sm" style={menuChip} href={PUBLIC_INSTALLER} data-testid="header-download-installer">Windows release files</a>
                  <p className="px-3 pb-2 text-xs text-muted" data-testid="installer-note">Published release files are separate from installed-device readiness. The installed app reports its exact executor, permissions, feature availability and operation receipts.</p>
                  <DesktopUpdateNote />
                </MenuCluster>
                </div>
              </AnchoredCard>
            ) : null}
          </div>

          <button
            type="button"
            className="inline-flex h-11 min-h-11 shrink-0 items-center gap-1 rounded-full border border-line bg-white/5 px-3 text-sm"
            aria-label="Speak"
            title="Speak is the call. It does not type into the field."
            onClick={openSpeakStage}
          >
            <Volume2 className="size-4" /> <span className="header-speak-label">Speak</span>
          </button>
          <button
            type="button"
            className="grid size-11 min-h-11 min-w-11 shrink-0 place-items-center rounded-full border border-line bg-white/5"
            aria-label="Alerts"
            aria-expanded={bellOpen}
            aria-controls="alerts-panel"
            data-testid="alerts-toggle"
            onClick={(event) => {
              const next = !bellOpen;
              closeMenus("bell");
              setAlertAnchor(event.currentTarget.getBoundingClientRect());
              setBellOpen(next);
            }}
          >
            <Bell className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-11 min-h-11 items-center gap-2 rounded-full border border-line px-2"
            aria-label="Account menu for Adrian"
            aria-expanded={accountOpen}
            aria-controls="account-panel"
            onClick={(event) => {
              const next = !accountOpen;
              closeMenus("account");
              setAccountAnchor(event.currentTarget.getBoundingClientRect());
              setAccountOpen(next);
            }}
          >
            <img src="/brand/logo-mark.jpg" alt="" width={32} height={32} className="size-8 rounded-full object-cover" />
            <span className="hidden text-sm md:inline">Adrian</span>
          </button>
        </header>
        {bellOpen && (
          <AnchoredCard anchor={alertAnchor} label="Alerts" onClose={() => setBellOpen(false)} testId="alerts-panel" width={300} align="end">
            <MenuGroup label="Status" first>
              {ws.halted ? <p className="px-3 py-2 text-sm text-danger">Emergency stop is on. Sending and approvals are blocked.</p> : null}
              {searchIssue && <button type="button" className="min-h-11 px-3 text-left text-sm text-danger" onClick={() => {
                setView("connected"); setCardFocus({ id: "owner-notion-search" }); closeMenus();
              }}>Notion search needs attention · {searchIssue.result} · Open Notion search</button>}
              {failure && failure.auditId !== searchIssue?.id && <button type="button" className="min-h-11 px-3 text-left text-sm text-danger" onClick={() => { setActivityQuery(""); setFocusAuditId(failure.auditId); setView("activity"); closeMenus(); }}>{failure.message} · View activity</button>}
              {ws.schedules.some((job) => job.lastError) && <button type="button" className="min-h-11 px-3 text-left text-sm text-danger" onClick={() => { setView("scheduled"); closeMenus(); }}>A scheduled job needs attention · Open Scheduled</button>}
              {!ws.halted && !searchIssue && !failure && !ws.schedules.some((job) => job.lastError) && <p className="px-3 py-2 text-sm text-muted">No current warnings.</p>}
            </MenuGroup>
            <MenuGroup label="Recent">
              {ws.audit.length === 0 ? <p className="px-3 py-2 text-sm text-muted">Nothing recorded yet.</p> : null}
              {ws.audit.slice(0, 4).map((entry) => (
                <p key={entry.id} className="px-3 py-2 text-sm text-muted">
                  {humanAction(entry.action)} · {stamp(entry.at)}
                </p>
              ))}
              {ws.audit.length > 0 ? <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { setActivityQuery(""); setView("activity"); closeMenus(); }}>View activity</button> : null}
            </MenuGroup>
          </AnchoredCard>
        )}
        {accountOpen && (
          <AnchoredCard anchor={accountAnchor} label="Account" onClose={() => setAccountOpen(false)} testId="account-panel" width={440} align="end">
            <MenuShelf width="100%" testId="account-shelf">
            <MenuCluster label="Account" wide>
              <p className="px-3 py-1 text-sm font-semibold">Adrian (Personal)</p>
              <p className="px-3 pb-2 text-xs text-muted">This menu is not an account switcher. No second workspace exists.</p>
              <UserButton />
              <SupabaseAccountControls />
              <SignedOut>
                <Link to="/login" search={{ next: loginReturnPath() }} className="flex min-h-11 items-center rounded-2xl px-3 text-sm" style={menuChip}>
                  Sign in
                </Link>
              </SignedOut>
            </MenuCluster>
            <MenuCluster label="Safety">
              <button type="button" className="flex min-h-11 items-center rounded-2xl px-3 text-left text-sm" style={menuChip} onClick={() => { setView("settings"); closeMenus(); }}>
                Settings
              </button>
              <button type="button" className="flex min-h-11 items-center rounded-2xl px-3 text-left text-sm" style={menuChip} onClick={() => void toggleStop()}>
                {ws.halted ? "Clear stop" : "Emergency stop"}
              </button>
            </MenuCluster>
            </MenuShelf>
          </AnchoredCard>
        )}
        {ws.halted && (
          <div className="banner-error mx-3 mt-2 flex flex-wrap items-center justify-between gap-2 px-4 py-2 md:mx-5">
            <p className="text-sm text-danger">Emergency stop is on. Sending and approvals are blocked.</p>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => void toggleStop()}>
              Clear stop
            </button>
          </div>
        )}
        {failure && (!failure.chatId || (view === "chat" && active?.id === failure.chatId)) && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2"
            role="alert"
            data-testid="failure-banner"
            data-failure-kind={failure.kind ?? "unknown"}
          >
            <p className="error-focus text-danger">{failure.message}</p>
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
              ) : failure.retry ? <button
                type="button"
                data-testid="failure-retry"
                className="inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
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
                className="chat-button chat-button--ghost"
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
                className="chat-button chat-button--ghost"
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
        {notice && (notice.startsWith("This link points at") || notice.startsWith("That bot is archived") || notice.startsWith("Link copied") || notice.startsWith("Clipboard copy")) ? (
          <p role="status" data-testid="share-notice" className="mx-3 mb-2 rounded-panel border border-line px-3 py-2 text-sm text-muted">{notice}</p>
        ) : null}
        <div ref={(node) => { pageScrollRef.current = node; pinPageScroller(node); }} className={`min-h-0 flex-1 ${view === "chat" || view === "dashboard" || view === "intelligence" ? "overflow-hidden" : "overflow-auto pb-24"}`}>
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
              onTalk={openSpeakStage}
              onAsk={async (text, showAnswer) => {
                const turn = await speakChatTurn(text, { stay: true });
                if (!turn.ok) return turn;
                showAnswer(turn.text);
                const spoken = await speak(turn.text).catch(() => undefined);
                return {
                  ...turn,
                  playbackError: spoken?.ok ? undefined : spoken?.error || "Audio playback did not finish.",
                };
              }}
              onOpenChat={() => { setView("command"); setNavOpen(false); }}
              onOpenCode={(text) => {
                const threads = wsRef.current.chats.filter((chat) => isIntelligenceThread(chat.customPersonality));
                const needle = text.trim().toLowerCase();
                const match = needle ? threads.find((chat) => chat.title.toLowerCase().includes(needle) || chat.messages.some((message) => message.content.toLowerCase().includes(needle))) : threads[0];
                if (match) {
                  setActiveId(match.id);
                  setView("code");
                  setNotice(`Resumed ${match.title}.`);
                  return;
                }
                handToHumanCode(text || "Continue the coding discussion", "From EVE");
              }}
              onOpenDashboard={() => { setView("dashboard"); setNavOpen(false); }}
              onOpenAgents={() => { setView("agents"); setNavOpen(false); }}
              onOpenRuns={() => { setView("runs"); setNavOpen(false); }}
              onOpenConnections={() => { setView("connected"); setNavOpen(false); }}
              recording={taskRecording}
              recordingSeconds={taskSeconds}
              onStopRecording={() => void stopTaskRecording()}
            />
          )}
          {view === "dashboard" && (
            <div className="h-full min-h-0">
              <Suspense fallback={<p className="p-6 text-sm text-muted">Opening the dashboard…</p>}>
                <DashboardApp />
              </Suspense>
            </div>
          )}
          {view === "command" && (
           <div id="command-home" className="gpt-home mx-auto flex min-h-full w-full max-w-none flex-col justify-start gap-4 p-4 md:p-6" style={{ justifyContent: "flex-start" }}>
              <div className="masthead flex w-full items-center gap-3">
                <div className="flex w-full flex-wrap items-end justify-between gap-3">
                  <div className="w-full min-w-0">
                    <div className="home-greeting">
                      <img src="/brand/logo-mark.jpg" alt="" width={52} height={52} />
                      <div>
                        <h1 className="font-display text-3xl font-bold md:text-4xl">
                          <span data-greeting={greet}>{greet}</span>, <span className="text-accent">Adrian</span>
                        </h1>
                        <p className="text-sm text-muted">What would you like to work on?</p>
                      </div>
                    </div>
                    <ModuleSuggestions draft={draft} onPick={pickModule} />
                    {ws.chats.length > 0 ? (
                      <div className="mt-3 w-full" aria-label="Recent">
                        <p className="mb-2 text-xs uppercase tracking-wide text-muted">Recent</p>
                        <ConversationSections
                          chats={getRecentChats(ws.chats, 6)}
                          activeId={activeId}
                          titleFor={shownChatTitle}
                          projects={ws.projects.map((project) => ({ id: project.id, name: project.name }))}
                          pinnedIds={ws.pins.filter((pin) => pin.kind === "chat").map((pin) => pin.ref)}
                          scheduledChatIds={ws.schedules.flatMap((job) => job.chatId ? [job.chatId] : [])}
                         onOpen={(id) => { setActiveId(id); setView("chat"); }}
                         onAction={runConversationAction}
                         extras={(ids) => (ids.length === 1 && ids[0] === activeId ? [{ label: "Download text transcript", onPick: () => exportActive(true) }, { label: "Download transcript JSON with attachments", onPick: () => exportActive() }] : [])}
                       />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
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
                    if (homeAction === "video") {
                      void runVideo(draft.trim() || undefined);
                      return;
                    }
                    void sendCommand();
                  }}
                >
                 <div className="composer-modes mb-2">
                   {homeAction !== "ask" ? (
                     <button type="button" className="chat-button chat-button--secondary" data-testid="mode-chip" onClick={() => { setHomeAction("ask"); setCommandMode("ask"); }}>
                       {homeAction === "image" ? "Image" : homeAction === "video" ? "Video" : homeAction === "write" ? "Write" : "Search"} ×
                     </button>
                   ) : null}
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
                    placeholder={homeAction === "image" ? "Describe the image" : homeAction === "video" ? "Describe the video" : homeAction === "write" ? "What should I write or edit?" : homeAction === "search" ? "Search the web" : "Ask Adrian"}
                    aria-label="Command"
                    data-testid="home-command"
                    rows={3}
                    className="input-glow w-full resize-none rounded-[1.1rem] border border-line/80 bg-bg/70 px-3 py-3 text-sm"
                  />
                  {error && !error.includes("Notion status") ? (
                    <p className="composer-error attachment-feedback" role="alert">
                      {error}{" "}
                      {error.includes("Sign in") ? <Link to="/login" search={{ next: loginReturnPath() }}>Sign in</Link> : null}
                    </p>
                  ) : null}
                  {notice ? (
                    <p className="composer-notice attachment-feedback mt-2 text-sm text-muted" role="status" data-testid="composer-notice">{presentVoiceCopy(notice)}</p>
                  ) : null}
                  {staged && (
                    <div className="attachment-feedback flex flex-wrap items-center gap-2 text-xs text-muted"><span>Attached: {staged.name}</span><button type="button" className="min-h-11 text-accent" onClick={() => { setStaged(null); setNotice(null); }}>Remove attachment</button></div>
                  )}
                  <div className="composer-toolbar mt-2 flex flex-wrap items-center gap-2">
                    <ComposerMore testId="home-composer-more-menu" onOpen={() => { setContextOpen(false); setToolsOpen(false); }}>
                        <MenuCluster label="Files">
                          <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} onClick={() => fileRef.current?.click()}>
                            <Paperclip className="size-4" /> Attach
                          </button>
                          <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} onClick={() => imageInputRef.current?.click()}>
                            <Image className="size-4" /> Image
                          </button>
                          <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} onClick={() => setCameraOpen(true)}>
                            <Camera className="size-4" /> Camera
                          </button>
                          {driveConnected ? (
                            <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} onClick={() => setCloudPickerOpen(true)}>
                              Drive
                            </button>
                          ) : null}
                        </MenuCluster>
                        <MenuCluster label="Create">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm"
                            style={menuChip}
                            disabled={busy || ws.halted}
                            onClick={() => {
                              const viaCmd = parseImagineCommand(draft);
                              const prompt = viaCmd !== null ? viaCmd : draft.trim();
                              void runImagine(prompt || undefined, null);
                            }}
                          >
                            Imagine
                          </button>
                          <AttachmentChips images={pendingImages} onRemove={(index) => setPendingImages((prev) => prev.filter((_, i) => i !== index))} onEditImagine={(image) => openImagineEditor(image.dataUrl)} />
                        </MenuCluster>
                        <MenuCluster label="Workspace">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm"
                            style={menuChip}
                            onClick={() => {
                              setToolsOpen(false);
                              setContextOpen((open) => !open);
                              document.querySelectorAll("details.composer-more[open]").forEach((node) => node.removeAttribute("open"));
                            }}
                          >
                            <Database className="size-4" /> Add Context
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm"
                            style={menuChip}
                            onClick={() => {
                              setContextOpen(false);
                              setToolsOpen((open) => !open);
                              document.querySelectorAll("details.composer-more[open]").forEach((node) => node.removeAttribute("open"));
                            }}
                          >
                            <Wrench className="size-4" /> Tools
                          </button>
                          <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} onClick={() => { setContextOpen(false); setToolsOpen(false); setView("agents"); }}>
                            <Bot className="size-4" /> Agents
                          </button>
                          <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} onClick={() => { setContextOpen(false); setToolsOpen(false); setProjectOpen(true); }}>
                            <Folder className="size-4" /> Projects
                          </button>
                        </MenuCluster>
                        <MenuCluster label="Chat" wide>
                          <ComposerEffortControl mode={composerEffort} onChoose={chooseComposerEffort} consultModules={consultModules} consultModel={consultModel} onConsultModel={chooseConsultModel} />
                          <label className="inline-flex min-h-11 items-center gap-2 text-xs text-muted" style={{ flex: "1 1 12rem", maxWidth: "100%" }}>
                            Style
                            <select aria-label="Conversation style" value={defaultPersonalityId} onChange={(event) => setDefaultPersonalityId(event.target.value as PersonalityId)} className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm text-fg">
                              {CONVERSATIONAL_PERSONALITIES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                            </select>
                          </label>
                          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm" style={menuChip} data-testid="translator-open" onClick={() => { document.querySelectorAll("details.composer-more[open]").forEach((node) => node.removeAttribute("open")); window.dispatchEvent(new CustomEvent("adrian:open-translator")); }}>
                            Translate
                          </button>
                        </MenuCluster>
                    </ComposerMore>
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

                    <button type="submit" disabled={busy || ws.halted || (!draft.trim() && pendingImages.length === 0 && !staged)} className="composer-send inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
                      <Send size={20} strokeWidth={1.75} /> {busy ? "Sending" : "Send"}
                    </button>
                    <button type="button" className="composer-mic-dictate inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm" data-testid="composer-mic-dictate" aria-label="Mic" title="Mic types into the field. It does not open Speak." onClick={onDictationMic}>
                      <Mic className="size-4" /> Mic
                    </button>
                    {dictation.phase !== "idle" ? (
                      <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm" data-testid="dictation-done" aria-label="Done" title="Insert the words at the cursor. Nothing is sent." onClick={onDictationMic}>
                        ✓
                      </button>
                    ) : null}
                    <button type="button" className="gpt-voice inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2f6bff] px-3 text-sm text-white" aria-label="Speak" title="Speak is the call. It does not type into the field." onClick={openSpeakStage}>
                      <Volume2 className="size-4" /> Speak
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm" aria-label="Dictation" title="Open the desktop dictation companion" onClick={() => { void fetch("http://127.0.0.1:4198/summon", { method: "POST" }).then((response) => { if (!response.ok) setNotice("The dictation companion is not running. It starts with the installed desktop app, not this website."); }).catch(() => setNotice("The dictation companion is not running on this computer. It is part of the installed desktop app, not this website.")); }}>
                      Dictation
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
                      Exclude from workspace archive by default. The chat stays in history and can still be downloaded on its own.
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
                    <li>Press Send to use the selected chat route. Choose Speak for a live voice conversation, or Mic to dictate a message.</li>
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

              <div className="gpt-starters" role="group" aria-label="Start a task" data-testid="start-shelf">
                <button type="button" aria-pressed={homeAction === "image"} onClick={() => { setHomeAction("image"); setCommandMode("ask"); }}>
                  <Image className="size-5" /> Create an image
                </button>
                <button type="button" aria-pressed={homeAction === "video"} onClick={() => { setHomeAction("video"); setCommandMode("ask"); }}>
                  <Video className="size-5" /> Create a video
                </button>
                <button type="button" aria-pressed={homeAction === "write"} onClick={() => { setHomeAction("write"); setCommandMode("ask"); }}>
                  <FileText className="size-5" /> Write or edit
                </button>
                <button type="button" aria-pressed={homeAction === "search"} onClick={() => { setHomeAction("search"); setCommandMode("research"); }}>
                  <Search className="size-5" /> Search the web
                </button>
              </div>
              <FirstSteps state={guide} onChange={persistGuide} onOpen={openGuide} />
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
                    const notes = ws.memories.filter((item) => item.scope === "project" && item.projectId === project.id && !item.archived).length;
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
                  <StatusRow icon={Bot} name="Voice" detail="Mic types into the field. Translator translates. Speak is the call." pill={speakStageOpen ? "Speak" : "Mic"} tone="muted" />
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

          {view === "chat" && notionPreview && notionPreview.owner === draftOwner && notionPreview.chatId === active?.id && (
            <section aria-label="Notion result" className="mx-auto w-full max-w-3xl rounded-panel border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <strong>Notion preview</strong>
                <button type="button" className="min-h-11 px-2" onClick={() => setNotionPreview(null)}>Dismiss</button>
              </div>
              <p className="text-sm text-muted">Visible here only. Copy any passage you want to include in your next message.</p>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words">{notionPreview.text}</pre>
            </section>
          )}
          {view === "chat" && (
            <ChatPane
              chatSettingsOpen={chatSettingsOpen}
              onChatSettingsToggle={(open) => {
                setChatSettingsOpen(open);
                if (!open) chatSettingsTrigger.current?.focus({ preventScroll: true });
              }}
              active={active}
              chats={ws.chats}
              personalityId={active?.personalityId ?? "assistant"}
              onPersonalityChange={(personalityId) => { if (active) setWs((prev) => updateChatPersonality(prev, active.id, personalityId)); }}
              customPersonality={active?.customPersonality ?? ""}
              onCustomPersonalityChange={(value) => { if (active) setWs((prev) => updateChatCustomPersonality(prev, active.id, value)); }}
              projectId={chatProjectId}
              projectName={ws.projects.find((project) => project.id === chatProjectId)?.name ?? null}
              onClearProject={() => setChatProjectId(null)}
              busy={busy && (!turnChat || (turnChat.ownerId === draftOwner && turnChat.chatId === active?.id))}
              liveText={turnChat && turnChat.chatId !== active?.id ? "" : liveText}
              halted={ws.halted}
              draft={draft}
              error={error}
              notice={notice}
              setDraft={setDraft}
              onPickModule={pickModule}
              onPick={(id) => setActiveId(id)}
              onSend={() => void sendInChat()}
              cue={cued.filter((item) => item.ownerId === draftOwner && item.chatId === active?.id)}
              onDropCue={(id) => rememberCue(dropCued(cueRef.current, id))}
              onReleaseCue={() => { if (active) void releaseNextCue(active.id, true); }}
              canStop={busy && turnChat?.ownerId === draftOwner && turnChat?.chatId === active?.id}
              onStop={stopReply}
              onRename={renameActive}
              onEdit={editMessage}
              onRegenerate={regenerate}
              onRetry={retryLast}
              onExport={exportActive}
              onDelete={() => {
                if (!active) return;
                requestProtected("delete", `delete-chat:${active.id}`, `Delete “${active.title}”`, "The transcript is removed. Saved notes stay until you delete them.", "Approve delete", () => {
                  setWs((prev) => pushAudit(removeConversations(prev, [active.id]), "delete_chat", active.id, "approved"));
                  setActiveId(null);
                });
              }}
              onDeleteChat={(id, title) => deleteSavedChats([id], `Delete “${title}”`)}
              onDeleteSection={(label, ids) => deleteSavedChats(ids, `Delete ${label}`)}
              projects={ws.projects.map((project) => ({ id: project.id, name: project.name }))}
              pinnedIds={ws.pins.filter((pin) => pin.kind === "chat").map((pin) => pin.ref)}
              scheduledChatIds={ws.schedules.flatMap((job) => job.chatId ? [job.chatId] : [])}
              onConversationAction={runConversationAction}
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
              onStopSpeak={interruptSpeakPlayback}
              onOpenSpeak={openSpeakStage}
              onOpenBuild={(text) => {
                sessionStorage.setItem(`adrian-build-draft.${draftOwner || "signed-out"}`, text.slice(0, 4000));
                setView("build");
                setNavOpen(false);
              }}
              onOpenHuman={(text) => handToHumanCode(text, "From Chat")}
              onListen={() => void listen()}
              onListenStop={() => void listen({ mode: "stop" })}
              onLiveUserTranscript={(text) => appendLiveTranscript("user", text)}
              onLiveAssistantTranscript={(text) => appendLiveTranscript("assistant", text)}
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
              consultModules={consultModules}
              consultModel={consultModel}
              onConsultModel={chooseConsultModel}
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
              driveConnected={driveConnected}
              onImagine={() => {
                const viaCmd = parseImagineCommand(draft);
                const prompt = viaCmd !== null ? viaCmd : draft.trim();
                void runImagine(prompt || undefined, active);
              }}
              onEditImagine={openImagineEditor}
              onSaveImage={(src, alt) => saveImageToComposer(src, alt)}
              onDownloadImage={(src, alt) => downloadImageDataUrl(src, alt)}
              onAddImageFile={(file) => void addImageAttachment(file)}
              onAnalyze={() => {
                if (staged) void inspectWithRea(staged, "research");
                else {
                  inspectFileRef.current?.click();
                }
              }}
              onDoctor={() => {
                setView("agents");
                void checkRea();
              }}
              providerChoices={providerOptions}
              providerChoice={effectiveProvider}
              onProvider={(id) => {
                if (isLogicRouteId(id)) {
                  const view = logicRoutes.find((item) => item.id === id);
                  if (!view?.ready) return;
                }
                selectProviderInChat(id);
              }}
              modelTier={modelTier}
              onModelTier={chooseModelTier}
              logicRoute={logicRoute}
              logicRoutes={logicRoutes}
              onChooseLogic={selectProviderInChat}
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
                  <img src="/brand/logo-mark.jpg" alt="" className="size-10 rounded-xl" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Projects</h2>
                    <p className="text-sm text-muted">Group this device’s chats, notes, and files by project.</p>
                  </div>
                </div>
                <button id="new-project-button" type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => setProjectOpen(true)}>
                  <Plus className="size-4" /> New Project
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="project-count px-3 py-2 text-sm">On this device ({ws.projects.length})</span>
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
                  const notes = ws.memories.filter((item) => item.scope === "project" && item.projectId === project.id && !item.archived).length;
                  const files = ws.files.filter((file) => file.projectId === project.id).length;
                  return (
                    <article key={project.id} id={`project-${project.id}`} tabIndex={-1} className="dense-card card-texture p-4" onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button, a")) return;
                      setShareProjectId(project.id);
                      setCardFocus({ id: `project-${project.id}` });
                    }}>
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
                      <p className="mt-3 text-xs text-muted">Created {stamp(project.createdAt)} · {chats} {chats === 1 ? "chat" : "chats"} · {notes} {notes === 1 ? "note" : "notes"} · {files} {files === 1 ? "file" : "files"}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="workspace-primary min-h-11 rounded-panel px-3 text-sm" onClick={() => { setChatProjectId(project.id); setProjectChoice(project.id); setActiveId(ws.chats.find((chat) => chat.projectId === project.id)?.id ?? null); setView("chat"); }}>Open chats</button>
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setMemoryTab("project"); setMemoryProject(project.id); setView("memory"); }}>Notes</button>
                        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setLibraryProjectId(project.id); setLibraryBand("files"); setView("files"); }}>Files</button>
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
              </div>
            </section>
          )}

          {view === "memory" && (
            <section className="page-shell p-4 md:p-6">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Memory</h2>
                    <p className="text-sm text-muted">Keep useful notes and choose when a chat can use them.</p>
                  </div>
                </div>
              </div>
              <div className="memory-permission-card mt-4 grid gap-3 rounded-panel border p-4 md:grid-cols-[1fr_auto]">
                <div className="flex items-center gap-3">
                  <Database aria-hidden="true" className="memory-permission-icon" />
                  <div>
                    <p className="font-semibold">Memory for new chats <span className={memoryChoice === "on" ? "text-ok" : "text-muted"}>{memoryChoice === "on" ? "on" : "off"}</span></p>
                    <p className="text-sm text-muted">{memoryChoice === "on" ? "New chats can use relevant notes in their scope. Existing chats keep their own setting." : "New chats start with memory off. Existing chats keep their own setting."}</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <button type="button" className="min-h-11 shrink-0 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => memoryChoice === "on" ? setMemoryChoice("off") : setArmMemory("composer")}>
                    {memoryChoice === "on" ? "Turn off" : "Enable Memory"}
                  </button>
                </div>
              </div>
              <div className="workspace-tabs mt-4 flex flex-wrap gap-2" role="group" aria-label="Memory views">
                {([
                  ["mine", "My Memory"],
                  ["project", "Project Memory"],
                  ["chat", "Chat notes"],
                  ["transfer", "Imports & Exports"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={memoryTab === id} onClick={() => setMemoryTab(id)} className="min-h-11 rounded-panel px-4 text-sm">
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted">{memoryTab === "chat" ? "Manage notes saved for individual conversations, including closed chats." : memoryTab === "project" ? "Project notes stay inside the project you pick." : memoryTab === "transfer" ? "Export is a JSON file with a hash. Import refuses a file whose hash does not match." : "Personal notes are global on this device. You can save and manage them here while chat use is off."}</p>
              {memoryTab === "transfer" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => void downloadArchive()}>Export archive</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" onClick={() => { setSettingsPane("data"); setView("settings"); }}>Open import settings</button>
                </div>
              )}
              {memoryTab !== "transfer" && <>
              <div className="memory-layout mt-4 grid gap-3 md:grid-cols-[16rem_1fr]">
                <div className="memory-overview rounded-panel border border-line bg-surface p-4 text-sm">
                <p className="font-semibold">Memory overview</p>
                  <p className="mt-3 flex justify-between"><span className="text-muted">Status</span><span className={memoryChoice === "on" ? "text-ok" : "text-danger"}>{memoryChoice === "on" ? "ON" : "OFF"}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Active notes</span><span>{ws.memories.filter((item) => !item.archived).length}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Archived notes</span><span>{ws.memories.filter((item) => item.archived).length}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Text size</span><span>{formatBytes(memoryBytes)}</span></p>
                  <p className="mt-3 text-xs text-muted">This size is the note text on this device. It is not a cloud quota.</p>
                </div>
                <div className="memory-editor grid min-w-0 gap-2">
                {memoryTab !== "chat" && <>
                <label className="text-sm font-medium" htmlFor="memory-new-note">New note</label>
                <textarea id="memory-new-note" value={memoryText} maxLength={2000} onChange={(event) => setMemoryText(event.target.value)} placeholder="Write a note you want kept" rows={2} aria-describedby="memory-text-count" className="rounded-panel border border-line bg-surface px-3 py-2 text-sm" />
                <p id="memory-text-count" className="text-xs text-muted">{memoryText.length.toLocaleString()} / 2,000 characters</p>
                <div className="flex flex-wrap gap-2">
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
                    disabled={!memoryText.trim()}
                    onClick={() => {
                      if (memoryScope === "project" && !memoryProject) {
                        setError("Pick a project for a project note.");
                        return;
                      }
                      setWs((prev) =>
                        pushAudit(
                          addMemory(prev, { scope: memoryScope, text: memoryText, source: "owner", projectId: memoryScope === "project" ? memoryProject || null : null, chatId: null }),
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
                </>}
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived
                </label>
                </div>
              </div>
              <ul className="memory-notes mt-4 space-y-2" aria-label="Saved notes">
                {memories.length === 0 && <li className="glow-card rounded-panel border border-line bg-surface p-6 text-center text-sm text-muted">{memoryQuery.trim() ? "No notes match your search." : "No saved notes in this view yet."}</li>}
                {memories.map((item) => (
                  <li
                    key={item.id}
                    id={"note-" + item.id} tabIndex={-1}
                    className="memory-note rounded-panel border border-line bg-surface p-3 text-sm"
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest("button, textarea, input")) return;
                      const timer = window.setTimeout(() => setNoteMenu(item.id), 550);
                      event.currentTarget.dataset.hold = String(timer);
                    }}
                    onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                    onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                    onPointerCancel={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                  >
                    {editId === item.id ? (
                      <label className="block text-sm">Edit note<textarea maxLength={2000} value={editText} onChange={(event) => setEditText(event.target.value)} className="min-h-20 w-full bg-transparent" /><span className="text-xs text-muted">{editText.length}/2000</span></label>
                    ) : (
                      <p className="memory-note-text whitespace-pre-wrap">{item.text}</p>
                    )}
                    <label className="flex min-h-11 items-center gap-2 text-xs">
                      <input type="checkbox" checked={item.alwaysApply === true} onChange={(event) => {
                        const checked = event.target.checked;
                        setWs((prev) => ({ ...prev, memories: prev.memories.map((note) => note.id === item.id
                          ? { ...note, alwaysApply: checked, updatedAt: new Date().toISOString() } : note) }));
                      }} /> Always apply when this note is in scope and memory is on
                    </label>
                    {item.versions.length > 0 && <details className="text-xs">
                      <summary>Previous wording ({item.versions.length}) · included in workspace archives</summary>
                      <ul>{item.versions.map((version, index) => <li key={index}>{stamp(version.at)} · {version.text}</li>)}</ul>
                      <button type="button" className="min-h-11" onClick={() => requestProtected("delete", `clear-note-versions:${item.id}`, "Remove previous wording", "The current note stays. Future exports will include only the current wording.", "Remove history", () => {
                        setWs((prev) => ({ ...prev, memories: prev.memories.map((note) => note.id === item.id ? { ...note, versions: [], updatedAt: new Date().toISOString() } : note) }));
                      })}>Remove previous wording</button>
                    </details>}
                    <p className="memory-note-meta mt-1 text-xs text-muted">{item.scope}{item.scope === "project" ? (ws.projects.some((project) => project.id === item.projectId) ? "" : " · project removed, note kept") : ""} · {stamp(item.updatedAt)}{item.archived ? " · archived" : ""}</p>
                    <div className="memory-note-actions"><ActionsButton label={`note: ${item.text.slice(0, 56)}`} onOpen={() => setNoteMenu(item.id)} /></div>
                    {editId === item.id ? <button type="button" disabled={!editText.trim()} className="mt-2 min-h-11 rounded-panel border border-line px-3" onClick={() => { setWs((prev) => pushAudit(reviseMemory(prev, item.id, editText), "save_memory", item.id, "revised")); setEditId(null); }}>Save edit</button> : null}
                  </li>
                ))}
              </ul>
              {noteMenu && memories.some((item) => item.id === noteMenu) ? (
                <ActionOverlay label="Actions for note" title="Note" onClose={() => setNoteMenu(null)}>
                  <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { const item = memories.find((note) => note.id === noteMenu); if (!item) return; setEditId(item.id); setEditText(item.text); setNoteMenu(null); }}>Edit</button>
                  <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => {
                    const item = memories.find((note) => note.id === noteMenu);
                    if (!item) return;
                    const action = item.archived ? "restored" : "archived";
                    setWs((prev) => pushAudit({ ...prev, memories: prev.memories.map((note) => (note.id === item.id ? { ...note, archived: !note.archived, updatedAt: new Date().toISOString() } : note)) }, "archive_memory", item.id, action));
                    setNoteMenu(null);
                  }}>{memories.find((note) => note.id === noteMenu)?.archived ? "Restore" : "Archive"}</button>
                  <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" style={{ color: "var(--color-danger)" }} onClick={() => {
                    const id = noteMenu;
                    setNoteMenu(null);
                    requestProtected("delete", `delete-memory:${id}`, "Delete this note", "The current text and its versions are removed from this browser.", "Approve delete", () => {
                      setWs((prev) => pushAudit(deleteMemory(prev, id), "delete_memory", id, "approved"));
                    });
                  }}>Delete</button>
                </ActionOverlay>
              ) : null}
              </>}
            </section>
          )}

          {view === "agents" && (
            <>
            <div className="page-hero mx-4 mt-4 flex items-center gap-3 md:mx-6">
              <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
              <div>
                <h2 className="font-display text-3xl font-bold">Bots &amp; agents</h2>
                <p className="text-sm text-muted">Save instructions once and use the bot in Chat, Runs, or Scheduled.</p>
              </div>
            </div>
            <FleetPanel mode="agents" catalogModels={catalogModels} ws={ws} setWs={setWs} onBotChat={openSavedBotChat}
              onBotRun={(id) => openBotDestination(id, "runs")} onBotSchedule={(id) => openBotDestination(id, "scheduled")}
              focusBotId={shareBotId}
              onBotSelect={(id) => { setShareBotId(id); setCardFocus({ id: `bot-${id}` }); }} />
            <details className="bot-builder-card mx-4 mb-6 p-3 md:mx-6">
            <summary className="min-h-11 cursor-pointer px-1 py-2 font-semibold">Workspace tools and diagnostics</summary>
            <SharedFleet />
            <ReaPanel
              title="Agents"
              lead="REA checks a file. Workspace lookup lists projects and chats, then searches notes. It does not call a model, browse the web, or mark itself running."
              report={reaReport}
              busy={reaBusy}
              onCheck={() => void checkRea()}
              onInspect={staged ? () => void inspectWithRea(staged, "agents") : null}
            />
            <section className="mx-4 mb-6 rounded-panel border border-line bg-surface p-4 md:mx-6">
            <form
              className="mt-3"
              onSubmit={(event) => {
                event.preventDefault();
                runLookup(lookupQuery);
              }}
            >
              <p className="font-semibold">Workspace lookup</p>
              <p className="mt-1 text-sm text-muted">Three local steps, in order. You approve them before they run. Stop blocks them.</p>
              <input aria-label="Word to find in notes" value={lookupQuery} onChange={(event) => setLookupQuery(event.target.value)} placeholder="Word to find in notes" className="mt-3 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
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
              <textarea aria-label="Planner goal" value={agentGoal} onChange={(event) => setAgentGoal(event.target.value)} placeholder="What should the planner look up?" rows={3} className="mt-3 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={ws.halted || agentBusy || !agentGoal.trim()}>Run planner</button>
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
                    <InlineImage key={`${image.name ?? "imagine"}-${index}`} src={image.dataUrl} alt={image.name ?? `Generated ${index + 1}`} onEditImagine={openImagineEditor} onSave={(src, alt) => saveImageToComposer(src, alt)} onDownload={(src, alt) => downloadImageDataUrl(src, alt)} />
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
            </section>
            </details>
            </>
          )}
          {view === "runs" && <FleetPanel key="runs" mode="runs" ws={ws} setWs={setWs} initialAgentId={botDestinationId} focusRunId={focusRunId} />}
          {view === "connected" && (
            <section className="page-shell">
              <div className="page-hero mb-4 flex items-center gap-3"><img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" /><div><h2 className="font-display text-3xl font-bold">Connected</h2><p className="text-sm text-muted">Setup explains what is missing. A service is connected only after the server says so.</p></div></div>
              {statusSignedIn === false ? <div className="sign-in-summary" role="status">Sign in to check your connections. <Link to="/login" search={{ next: loginReturnPath() }}>Sign in</Link></div> : null}
              <ServiceBoard key={account?.id ?? "guest"}
                providers={customAiProviders}
                savedMcp={mcpSavedListState.status === "ready" ? mcpServers : []}
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
                  const node = document.getElementById(target);
                  const box = node?.closest("details");
                  if (box) box.open = true;
                  node?.scrollIntoView({ behavior: document.documentElement.dataset.adrianMotion === "reduce" ? "instant" : "smooth", block: "center" });
                  setNotice("The paste form is open below. A card is connected only after the server says so.");
                }}
                onDisconnect={() => {
                  notionEpoch.current++;
                  const issue = notionSearchIssue(wsRef.current.audit);
                  if (issue) {
                    setWs((prev) => pushAudit(prev, "notion_search_disconnected", "notion:search", "Disconnected."));
                    setFailure((active) => active?.auditId === issue.id ? null : active);
                  }
                  setNotionPreview(null);
                  setNotion({ state: "disconnected", detail: "Notion disconnected." });
                  setNotionQuery("");
                  setNotionPages([]);
                  setNotionNote(null);
                }}
              />
              <details className="intelligence-group mt-4">
                <summary className="cursor-pointer text-sm font-semibold">Notion search</summary>
              <form
                id="owner-notion-search" tabIndex={-1}
                className="rounded-panel border border-line bg-surface p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchConnectedNotion(notionQuery.trim());
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
              </details>
              <details className="intelligence-group">
                <summary className="cursor-pointer text-sm font-semibold">Custom MCP</summary>
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
                <label className="mt-3 block text-sm">Connection name<input value={mcpLabel} onChange={(event) => setMcpLabel(event.target.value)} className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3" /></label>
                <label className="mt-3 block text-sm">Server URL<input type="url" required pattern="https://.+" title="Enter an HTTPS URL" value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://example.com/mcp" aria-label="MCP server address" className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3" /></label>
                <label className="mt-3 block text-sm">Access token (optional)<input value={mcpToken} onChange={(event) => setMcpToken(event.target.value)} type="password" autoComplete="off" className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3" /></label>
                <button type="submit" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={ws.halted || mcpMutationBusy || !mcpUrl.trim()}>{mcpMutationBusy ? "Checking connection…" : "Test and save"}</button>
                <ul className="mt-3 space-y-2">
                  {mcpSavedListState.status === "ready" && mcpServers.map((server) => (
                    <li tabIndex={-1} ref={focusConnection} id={`connection-${server.id}`} key={server.id} className="rounded-panel border border-line px-3 py-2 text-sm">
                      <span className="font-semibold">{server.label}</span>
                      <span className="ml-2 text-muted">{server.host} · {server.state}</span>
                      <p className="text-muted">{server.error || server.tools.map((tool) => tool.name).join(", ") || "No tools returned."}</p>
                      <ul className="mt-2 space-y-1">
                        {server.tools.map((tool) => (
                          <li key={tool.name}>
                            <button type="button" className="min-h-11 w-full rounded-panel border border-line px-3 text-left text-xs" onClick={() => selectProviderInChat(`mcp:${server.id}:${encodeURIComponent(tool.name)}`)}>
                              {tool.name} · Use in chat
                            </button>
                          </li>
                        ))}
                      </ul>
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
              </details>
              {notice && <p className="voice-copy rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{presentVoiceCopy(notice)}</p>}
              <details className="intelligence-group">
                <summary className="cursor-pointer text-sm font-semibold">API keys</summary>
              <AiProviderConnections onChange={setCustomAiProviders} onUseModel={selectProviderInChat} />
              </details>
              <details className="intelligence-group">
                <summary className="cursor-pointer text-sm font-semibold">Provider routes</summary>
              <FleetPanel
                mode="connected"
                catalogModels={catalogModels}
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
              </details>
            </section>
          )}
          {view === "scheduled" && <FleetPanel key="scheduled" mode="scheduled" ws={ws} setWs={setWs} initialAgentId={botDestinationId} />}
          {view === "tools" && <><NativeDevicePanel key={account?.id ?? "signed-out"} ownerId={account?.id ?? null} halted={ws.halted} /><FleetPanel mode="tools" ws={ws} setWs={setWs} onFailure={(message, retry, surface) => reportFailure(message, surface === "mcp" ? "mcp_tool_failed" : "open_page_failed", surface === "mcp" ? "mcp:tools" : "browser", retry)} /></>}
          {view === "build" && (
            <section className="page-shell">
              <BuildWorkspace freeOnly={researchFreeOnly} key={draftOwner ?? "signed-out"} ownerId={draftOwner ?? undefined} onDiscuss={(text) => handToHumanCode(text, "From Build")} onResult={(text) => {
                const id = sessionStorage.getItem(`adrian-human-return.${draftOwner || "signed-out"}`);
                if (!id) { handToHumanCode(text, "Build result"); return; }
                sessionStorage.removeItem(`adrian-human-return.${draftOwner || "signed-out"}`);
                setWs((prev) => appendHumanResult(prev, id, "Build result", text || "Build finished. No output was reported."));
                setActiveId(id);
                setView("code");
                setNotice("Build result saved in the Intelligence thread.");
              }} halted={ws.halted} recording={taskRecording} recordingSeconds={taskSeconds} onOpenSpeak={openSpeakStage} onToggleStop={() => { void toggleStop(); }} onStopRecording={() => void stopTaskRecording()} />
            </section>
          )}
          {view === "code" && (
            <HumanCodePanel
              threads={ws.chats.filter((chat) => isIntelligenceThread(chat.customPersonality)).map((chat) => ({ id: chat.id, title: shownChatTitle(chat), messages: chat.messages }))}
              activeId={activeId || ""}
              busy={busy}
              notice={notice}
              onNew={openHumanCode}
              onOpen={(id) => { setActiveId(id); setView("code"); }}
              onSend={(id, text, image) => void sendHumanCode(id, text, image)}
              onBuild={(text) => { if (activeId) sessionStorage.setItem(`adrian-human-return.${draftOwner || "signed-out"}`, activeId); sessionStorage.setItem(`adrian-build-draft.${draftOwner || "signed-out"}`, text.slice(0, 4000)); setView("build"); setNavOpen(false); }}
              halted={ws.halted}
            />
          )}
          {view === "research" && researchOwner === draftOwner && (
            <section className="page-shell">
              <div className="page-hero card-texture">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Research</h2>
                    <p className="text-sm text-muted">Search uses the Grok key saved on this computer. Citations appear only when the search returns real links.</p>
                  </div>
                </div>
              </div>
              <div className="solid-form research-workbench mt-4">
                <nav className="workspace-tabs mb-3 flex flex-wrap gap-2" aria-label="Research page">
                  {([
                    ["search", "Ask"],
                    ["saved", "Saved"],
                    ["files", "Files"],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" className="min-h-11 rounded-panel border px-3 text-sm" aria-pressed={researchBand === id} onClick={() => setResearchBand(id)}>{label}</button>
                  ))}
                </nav>
                <div hidden={researchBand !== "search"}>
                <label className="text-sm" htmlFor="research-question">Question</label>
                <textarea id="research-question" value={researchText} onChange={(event) => setResearchText(event.target.value)} placeholder="What do you want to research?" rows={3} className="input-glow mt-2 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
                <p className="mt-2 text-sm text-muted">{researchFreeOnly ? "Free-only selection. No verified free search provider is available." : `Research provider: ${searchProvider}. Provider usage may be billed.`}</p>
                <button type="button" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={ws.halted || researchFreeOnly || searchProvider === "Unavailable" || searchProvider === "Checking search route" || researchPending || !researchText.trim()} onClick={() => void startResearch()}>
                  {researchPending ? "Searching…" : "Start research"}
                </button>
                {researchReportQuestion && <h3 className="mt-3 font-semibold">{researchReportQuestion}</h3>}
                {researchNote ? <p className="mt-3 text-sm text-muted">{researchNote}</p> : null}
                {researchCitations.length === 0 && !researchNote ? (
                  <p className="mt-3 text-sm text-muted">Reports and their sources appear here after a search.</p>
                ) : null}
                {researchSteps?.some((step) => !step.ok) && (
                  <button type="button" disabled={researchPending || ws.halted || researchFreeOnly} className="min-h-11 text-sm text-accent" onClick={() => {
                    const report = researchHistory.find((item) => item.question === researchReportQuestion && item.steps === researchSteps);
                    if (report) void startResearch(report.question, report);
                  }}>Retry missing searches</button>
                )}
                {researchCitations.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {researchCitations.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => (
                      <li key={item.url} className="dense-row">
                        <a className="text-accent underline" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                      </li>
                    ))}
                  </ul>
                )}
                {researchCitations.length > 0 ? (
                  <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => {
                    const sources = researchCitations.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => `${item.title}: ${item.url}`).join("\n");
                    setDraftInScope(JSON.stringify([draftOwner, active?.id ?? "home", followupPrivate]), Boolean(draftOwner) && !followupPrivate, (prior) => (prior ? prior + "\n\n" : "") + `Research report for: ${researchReportQuestion || researchText}\n${researchNote || ""}\n\nSources:\n${sources}\n\nFollow-up question: `);
                    setView("chat");
                    setNavOpen(false);
                  }}>Ask a follow-up in Chat</button>
                ) : null}
                {researchHistory.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-semibold">Recent reports</p>
                    <ul className="mt-2 space-y-2">
                      {researchHistory.map((report) => (
                        <li key={report.id}>
                          <button type="button" disabled={researchPending} className="min-h-11 text-left text-sm text-accent" onClick={() => { setResearchText(report.question); setResearchReportQuestion(report.question); setResearchNote(report.summary); setResearchCitations(report.citations); setResearchSteps(report.steps); setResearchBand("search"); }}>
                            {report.question} · {report.citations.length} sources
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                </div>
              </div>
              <div className="mt-4" hidden={researchBand !== "saved"}>
                <ResearchPanel onUse={setResearchText} start="saved" />
              </div>
              <div className="mt-4" hidden={researchBand !== "files"}>
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
          {view === "voice" ? <VoiceCloningStudioPage onBack={() => { setView("command"); setNavOpen(false); }} /> : null}
          <section className={view === "skills" ? "page-shell space-y-4" : "hidden"}>
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Skills</h2>
                    <p className="text-sm text-muted">Built-in skills read this device. Not installed means the outside service is not connected.</p>
                  </div>
                </div>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="skill-refresh" data-asked-permission="false" onClick={() => setSkillRefreshNonce((n) => n + 1)}>Refresh</button>
              </div>
              <p role="status" className="text-sm text-muted" data-testid="skill-refresh-status">{skillInventoryStatus}</p>
              <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="Search skills" aria-label="Search skills" className="min-h-11 w-full rounded-panel border border-line bg-surface px-3 text-sm" />
              <nav className="flex flex-wrap gap-2" aria-label="Skill groups">
                {([
                  ["device", "On this device"],
                  ["installed", "Installed"],
                  ["missing", "Not installed"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" className={`min-h-11 rounded-panel border px-3 text-sm ${skillBand === id ? "border-accent bg-accent text-accent-ink" : "border-line"}`} aria-pressed={skillBand === id} onClick={() => setSkillBand(id)}>{label}</button>
                ))}
              </nav>
              {skillBand === "installed" && <details className="rounded-panel border border-line p-3" open={skillQuery.trim() ? true : undefined}>
                <summary>Server instruction sets ({skillInventory.length})</summary>
                <ul className="mt-2">{skillInventory.filter((name) => name.toLowerCase().includes(skillQuery.trim().toLowerCase())).map((name) => <li key={name}>{name}</li>)}</ul>
              </details>}
              <div id="owner-skills">
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).filter((skill) => skillBand === "device" ? skill.kind === "built-in" : skillBand === "installed" ? skill.kind === "installed" : skill.kind === "not-installed").map((skill) => {
                  const required = skill.id === "adrian-os-builder";
                  const on = required || (skill.kind !== "not-installed" && enabledSkills[skill.id] !== false);
                  return (
                    <article key={skill.id} className="skill-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <img src={productMark(SKILL_MARK[skill.id] ?? "skills")} alt="" className="size-8 shrink-0 rounded-lg object-contain" style={markTile(productMark(SKILL_MARK[skill.id] ?? "skills"))} />
                          <h3 className="font-semibold">{skill.name}</h3>
                        </div>
                        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{skill.kind === "not-installed" ? "Not installed" : skill.kind === "installed" ? (on ? "Installed" : "Off") : (on ? "On" : "Off")}</span>
                      </div>
                      <p className="mt-2 text-sm">{skill.description}</p>
                      <p className="mt-1 text-sm text-muted">{skill.needs}</p>
                      {skill.tool === "search_notes" && <label className="mt-2 block text-sm">Words to find<input value={skillNoteQuery} onChange={(event) => setSkillNoteQuery(event.target.value)} className="mt-1 block min-h-11 w-full rounded-panel border border-line bg-bg px-3" /></label>}
                      <div className="mt-3 flex gap-2">
                        {skill.kind !== "not-installed" && !required ? (
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
                        {skill.kind !== "not-installed" && <button
                          type="button"
                          disabled={!on || (skill.tool === "search_notes" && !skillNoteQuery.trim())}
                          className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink"
                          onClick={() => setSkillResult({ id: skill.id, text: runSkill(ws, skill, on, skillNoteQuery).text })}
                        >
                          {required ? "View Build instructions" : "Run"}
                        </button>}
                        {skill.id === "notion" && <button type="button" className="min-h-11 text-sm text-accent" onClick={() => setView("connected")}>Open connections</button>}
                      </div>
                      {skillResult?.id === skill.id && <p role="status" className="mt-2 whitespace-pre-wrap break-words rounded-panel border border-line p-3 text-sm">{skillResult.text}</p>}
                    </article>
                  );
                })}
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).filter((skill) => skillBand === "device" ? skill.kind === "built-in" : skillBand === "installed" ? skill.kind === "installed" : skill.kind === "not-installed").length === 0 && !(skillBand === "installed" && skillInventory.some((name) => name.toLowerCase().includes(skillQuery.trim().toLowerCase()))) && <p className="rounded-panel border border-line p-4 text-sm text-muted">No skills match “{skillQuery.trim()}” in this group.</p>}
              </div>
              {skillStorageError && <p className="rounded-panel border border-danger/40 p-3 text-sm text-danger" role="alert">{skillStorageError}</p>}
              {notice && <p className="voice-copy rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{presentVoiceCopy(notice)}</p>}
              <details className="owner-fold">
                <summary>Draft library</summary>
                <LocalSkillsTools skills={SKILLS} enabledSkills={Object.fromEntries(SKILLS.map((skill) => [skill.id, skill.kind !== "not-installed" && enabledSkills[skill.id] !== false]))} />
              </details>
          </section>
          {view === "files" && (
            <section className="page-shell">
              <div className="page-hero mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Library</h2>
                  <p className="text-sm text-muted">Read saved text, Markdown, CSV, JSON, and text extracted from PDFs.</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => fileRef.current?.click()}>Upload file</button>
                  {driveConnected ? <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" onClick={() => setCloudPickerOpen(true)}>Browse Drive</button> : null}
                </div>
              </div>
              <div id="owner-library">
                {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
                {notice && <p role="status" className="mb-2 text-sm text-muted">{notice}</p>}
                <nav className="workspace-tabs mb-3 flex flex-wrap gap-2" aria-label="Library groups">
                  {([
                    ["files", "Files"],
                    ["preview", "Preview"],
                    ["media", "Media"],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" className="min-h-11 rounded-panel border px-3 text-sm" aria-pressed={libraryBand === id} onClick={() => setLibraryBand(id)}>{label}</button>
                  ))}
                </nav>
                <aside className="library-list text-sm" hidden={libraryBand !== "files"}>
                  <p className="font-semibold">Text copies</p>
                  <p className="mt-2 text-xs text-muted">Read the saved text. Keep the original file for its full contents.</p>
                  <ul className="library-text-copies mt-3">
                    {libraryProjectId && <li className="flex flex-wrap items-center gap-3"><span>Project: {ws.projects.find((project) => project.id === libraryProjectId)?.name ?? "Unnamed project"}</span><button type="button" onClick={() => setLibraryProjectId(null)} className="min-h-11 text-accent">All files</button></li>}
                    {!ws.files.some((file) => !libraryProjectId || file.projectId === libraryProjectId) && (
                      <li className="empty-state py-6">
                        <img src="/empty/empty-folder.svg" alt="" />
                        <p className="text-muted">No files yet.</p>
                      </li>
                    )}
                    {ws.files.filter((file) => !libraryProjectId || file.projectId === libraryProjectId).map((file) => (
                      <li key={file.id}>
                        <button type="button" aria-label={file.name} onClick={() => { setOpenFileId(file.id); setLibraryBand("preview"); }} className="library-file min-h-11 w-full text-left">
                          <FileText aria-hidden="true" className="library-file-icon" />
                          <span><strong>{file.name}</strong><small>{formatBytes(file.bytes)} · {stamp(file.createdAt)}</small></span>
                          <span className="library-file-arrow" aria-hidden="true">›</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>
                <div className="dense-card p-4 text-sm" hidden={libraryBand !== "preview"}>
                  {!ws.files.find((file) => file.id === openFileId) && (
                    <div className="empty-state">
                      <img src="/empty/empty-folder.svg" alt="" />
                      <p className="font-semibold">Select a file</p>
                      <p className="text-muted">Upload a file, or choose a saved text copy in Files.</p>
                    </div>
                  )}
                  {ws.files.filter((file) => file.id === openFileId).map((file) => (
                    <div key={file.id}>
                      <p className="font-semibold [overflow-wrap:anywhere]">{file.name}</p>
                      {file.partial && <p className="text-sm text-muted">Partial text copy. Keep the original for the full contents.</p>}
                      <p className="text-xs text-muted">{formatBytes(file.bytes)} · {stamp(file.createdAt)} · {describeFile(file.name, file.text).summary}</p>
                      <pre tabIndex={0} aria-label="File text" className="mt-3 max-h-[60dvh] overflow-auto break-words whitespace-pre-wrap rounded-panel bg-bg p-3 text-sm">{file.text}</pre>
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
                <div className="dense-card p-4 text-sm" hidden={libraryBand !== "media"} data-testid="library-media">
                  <p className="font-semibold">Chat images</p>
                  <p className="mt-1 text-xs text-muted">Grouped from saved chats. A picture is listed only when its image data is already in the chat.</p>
                  {(["attached", "camera", "generated"] as const).map((kind) => {
                    const items = ws.chats.flatMap((chat) => listChatGalleryImages(chat.messages).filter((item) => item.kind === kind));
                    return (
                      <div key={kind} className="mt-3" data-testid={`library-media-${kind}`}>
                        <p className="text-xs uppercase tracking-wide text-muted">{kind} · {items.length}</p>
                        {items.length === 0 ? <p className="text-sm text-muted">None saved in this browser.</p> : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {items.map((item) => <img key={item.key} src={item.src} alt={item.name} className="size-16 rounded-panel border border-line object-cover" />)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
          {view === "integrations" && (
            <section className="page-shell">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
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
                          <img src={productMark(CAPABILITY_MARK[item.id] ?? "integrations")} alt="" className="size-8 shrink-0 rounded-lg object-contain" style={markTile(productMark(CAPABILITY_MARK[item.id] ?? "integrations"))} />
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
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Activity</h2>
                    <p className="text-sm text-muted">Recent workspace activity · up to 200 recorded events</p>
                  </div>
                </div>
              </div>
              {imageAllowance && <p className="mt-3 text-sm">Imagine allowance: {imageAllowance.remaining} of {imageAllowance.dailyCap} images remaining. Resets at {new Date(imageAllowance.resetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} local time (midnight UTC). {imageAllowance.unconfirmed > 0 && `${imageAllowance.unconfirmed} reserved with provider outcome unconfirmed.`}</p>}
              {allowanceError && <p role="status" className="mt-3 text-sm">Image allowance unavailable. {allowanceError}</p>}
              {ws.usage.length > 0 && <details className="mt-3 rounded-panel border border-line p-3">
                <summary>Recent model usage · up to 200 replies</summary>
                <ul>{ws.usage.map((entry) => <li key={entry.id} className="mt-2 break-words text-sm">
                  {stamp(entry.at)} · {entry.provider || "Provider unreported"} · {entry.model}
                  {entry.requestedModel && entry.requestedModel !== entry.model && <> · Requested {entry.requestedModel}</>}
                  <div>Input tokens: {entry.promptTokens ?? "unknown"} · Output tokens: {entry.completionTokens ?? "unknown"}</div>
                  {entry.requestId && <div>Request: {entry.requestId}</div>}
                </li>)}</ul>
              </details>}
              <input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Filter activity" className="input-glow mt-4 min-h-11 w-full rounded-panel border border-line bg-surface/80 px-3 text-sm" aria-label="Filter activity" />
              <ul className="mt-4 space-y-2">
                {ws.audit.length === 0 && (
                  <li className="empty-state">
                    <img src="/empty/empty-activity.svg" alt="" />
                    <p className="font-semibold">No events yet</p>
                    <p className="text-sm text-muted">Actions you take will appear here.</p>
                  </li>
                )}
                {ws.audit.filter((entry) => `${humanAction(entry.action)} ${entry.result} ${entry.target}`.toLowerCase().includes(activityQuery.trim().toLowerCase())).length === 0 && ws.audit.length > 0 && (
                  <li className="text-sm text-muted">No events match that filter.</li>
                )}
                {ws.audit.filter((entry) => `${humanAction(entry.action)} ${entry.result} ${entry.target}`.toLowerCase().includes(activityQuery.trim().toLowerCase())).map((entry) => (
                  <li
                    key={entry.id}
                    id={`audit-${entry.id}`}
                    className={`dense-card dense-row flex-wrap justify-between text-sm ${focusAuditId === entry.id ? "border-danger bg-danger/10" : ""}`}
                  >
                    <div>
                      <p className="font-semibold">{humanAction(entry.action)}</p>
                      <p className="break-words text-muted">{entry.result}</p>
                      {entry.target && <p className="break-all text-xs text-muted">Reference: {entry.target}</p>}
                    </div>
                    <p className="text-xs text-muted">{stamp(entry.at)}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {view === "help" && (
            <section className="page-shell mx-auto w-full max-w-none space-y-4">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
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
              <div id="owner-help" className="adrian-layer grid gap-2">
                {helpQuery.trim() && <button type="button" className="mb-2 min-h-11 text-sm text-accent" onClick={() => setHelpQuery("")}>Clear search</button>}
                {(() => {
                  const topics = [
                  { id: "keys", label: "Copy a saved API key", detail: "Copy my key, token, or credential. Owner key copying is available on the local device.", mark: "/brand/logo-mark.jpg", open: () => { setSettingsPane("keys"); setView("settings"); } },
                  { id: "chat", label: "Send a chat", detail: "Type in the field and press Enter, or press the blue button. An empty field opens Speak.", mark: "/brand/logo-mark.jpg", open: () => setView("command") },
                  { id: "speak", label: "Speak", detail: "Opens the call screen with camera, screen share, mute, and end.", mark: "/brand/logo-mark.jpg", open: openSpeakStage },
                  { id: "settings", label: "Settings", detail: "Theme, voice, connections, and the pages that stay off the short sidebar.", mark: "/brand/logo-mark.jpg", open: () => setView("settings") },
                  { id: "plugins", label: "Plugins", detail: "Catalog and connection marks. Opening a row does not connect the service.", mark: "/brand/logo-mark.jpg", open: () => setView("connected") },
                  { id: "library", label: "Library", detail: "Text copies in this browser. Upload text or open a file you already attached.", mark: "/brand/logo-mark.jpg", open: () => setView("files") },
                  { id: "projects", label: "Projects", detail: "Records on this device. Open chats or notes from a project card.", mark: "/brand/logo-mark.jpg", open: () => setView("projects") },
                  { id: "scheduled", label: "Scheduled", detail: "Jobs that wait for a time. Nothing runs until you start it.", mark: "/brand/logo-mark.jpg", open: () => setView("scheduled") },
                  { id: "build", label: "Build", detail: "Adrian Build workspace. A task can edit the hosted workspace, or a paired computer when one is connected.", mark: "/brand/logo-mark.jpg", open: () => setView("build") },
                  { id: "explore", label: "Explore", detail: "Filter local templates, save one, then open it in Chat.", mark: "/brand/logo-mark.jpg", open: () => window.location.assign("/explore") },
                  { id: "dashboard", label: "Dashboard", detail: "Opens the workspace map inside this app.", mark: "/brand/logo-mark.jpg", open: () => setView("dashboard") },
                  { id: "research", label: "Research", detail: "Opens the free-first research website.", mark: "/brand/logo-mark.jpg", open: () => window.location.assign("/research") },
                  { id: "social", label: "Social", detail: "Adrian Social runs inside this software.", mark: "/apps/social/assets/mark.jpg", open: () => window.location.assign("/social") },
                  { id: "gpt-wrapper", label: "GPT wrapper", detail: "The GPT wrapper runs inside this software.", mark: "/brand/marks/gpt-wrapper.svg", open: () => window.location.assign("/gpt-wrapper") },
                  ].filter((item) => helpQuery.toLowerCase().trim().split(/\s+/).every((word) => `${item.label} ${item.detail}`.toLowerCase().includes(word)));
                  if (topics.length === 0) return <p className="mt-2 text-sm text-muted" role="status">No help topics match this search. Try “key,” “Library,” or “chat.”</p>;
                  return topics.map((item) => (
                  <button key={item.id} type="button" className="adrian-row flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line px-3 text-left text-sm" onClick={() => { item.open(); setNavOpen(false); }}>

                    <img src={item.mark} alt="" width={28} height={28} className="size-7 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.label}</span>
                      <span className="block text-xs text-muted">{item.detail}</span>
                    </span>
                    <span className="text-muted" aria-hidden="true">›</span>
                  </button>
                  ));
                })()}
              </div>
            </section>
          )}

          {view === "settings" && (
            <section className="page-shell intelligence-main mx-auto w-full max-w-none">
              <div className="page-hero">
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Settings</h2>
                    <p className="text-sm text-muted">Preferences stay in this browser. Open a group to reach its pages.</p>
                  </div>
                </div>
              </div>
              <nav className="intelligence-main space-y-3" aria-label="Settings sections" hidden={settingsPane !== null}>
                {([
                  { group: "Account", items: [
                    ["sign-in", "Sign in", "Keep this account’s own copy", () => { window.location.assign("/login?next=" + encodeURIComponent(loginReturnPath())); }],
                    ["sign-up", "Sign up", "A new account starts empty", () => { window.location.assign("/login?mode=sign-up"); }],
                    ["keys", "Safe keys", "Open a saved key and copy it", () => setSettingsPane("keys")],
                    ["data", "Data", "What stays in this browser", () => setSettingsPane("data")],
                    ["safety", "Safety", "Stops and confirmations", () => setSettingsPane("safety")],
                  ]},
                  { group: "Preferences", items: [
                    ["general", "Appearance", "Dark, light, motion, or follow this device", () => setSettingsPane("general")],
                    ["browser", "Cloud browser", "Website permissions and browser data", () => setSettingsPane("browser")],
                    ["voice", "Voice", "Speak voice and pace", () => setSettingsPane("voice")],
                  ]},
                  { group: "Personalization", items: [
                    ["personalization", "Personalization", "Default style for new conversations", () => setSettingsPane("personalization")],
                  ]},
                  { group: "Connections", items: [
                    ["plugins", "Plugins", "Connected services and Build links", () => { setView("connected"); setNavOpen(false); }],
                    ["connections", "Connections", "API keys and saved providers", () => setSettingsPane("connections")],
                  ]},
                  { group: "System", items: [
                    ["integrations", "Integrations", "What each provider can do", () => { setView("integrations"); setNavOpen(false); }],
                    ["scheduled", "Scheduled", "Jobs that wait for a time", () => { setView("scheduled"); setNavOpen(false); }],
                    ["tools", "Tools", "What this app can call", () => { setView("tools"); setNavOpen(false); }],
                    ["skills", "Skills", "Installed abilities", () => { setView("skills"); setNavOpen(false); }],
                    ["voice", "Voice clone", "Authorized profiles. Not Speak and not dictation.", () => { setView("voice"); setNavOpen(false); }],
                    ["memory", "Memory", "Notes you chose to keep", () => { setView("memory"); setNavOpen(false); }],
                    ["activity", "Activity", "What this device recorded", () => { setView("activity"); setNavOpen(false); }],
                    ["help", "Help", "How the controls behave", () => { setView("help"); setNavOpen(false); }],
                  ]},
                ] as const).filter((section) => !hiddenSettings.includes(section.group)).map((section) => (
                  <section key={section.group} className="adrian-layer intelligence-group" aria-label={section.group}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="min-w-0">{section.group}</h3>
                      <ActionsButton label={`${section.group} section`} onOpen={() => setSettingsMenu(section.group)} />
                    </div>
                    <div className="settings-index">
                    {section.items.map(([id, label, detail, open]) => (
                      <button key={id} type="button" className="adrian-row" onClick={open}>
                        <span>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </span>
                      </button>
                    ))}
                    </div>
                  </section>
                ))}
                {hiddenSettings.length > 0 && (
                  <section className="adrian-layer intelligence-group" aria-label="Hidden sections">
                    <h3>Hidden sections</h3>
                    <div className="grid gap-2">
                      {hiddenSettings.map((name) => (
                        <button key={name} type="button" className="adrian-row min-h-11 rounded-2xl border border-line px-3 text-left text-sm" onClick={() => rememberHiddenSettings(restoreSection(hiddenSettings, name))}>Restore {name}</button>
                      ))}
                    </div>
                  </section>
                )}
              </nav>
              {settingsMenu && (
                <ActionOverlay label={`Actions for ${settingsMenu} section`} title={settingsMenu} onClose={() => setSettingsMenu(null)}>
                  <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { rememberHiddenSettings(hideSection(hiddenSettings, settingsMenu)); setSettingsMenu(null); }}>Hide section</button>
                </ActionOverlay>
              )}
              {settingsPane && (
                <button type="button" className="text-sm text-muted" onClick={() => setSettingsPane(null)}>Back</button>
              )}
              {settingsPane === "personalization" && <label className="settings-card grid gap-2 rounded-panel p-4 text-sm">
                Default style for new conversations
                <select value={defaultPersonalityId} onChange={(event) => setDefaultPersonalityId(resolvePersonalityId(event.target.value))} className="min-h-11 rounded-panel border border-line bg-surface px-3">
                  {CONVERSATIONAL_PERSONALITIES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </label>}
              {settingsPane === "browser" && <CloudBrowserSettings key={draftOwner ?? "signed-out"} owner={draftOwner} />}
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
                      <button key={choice} type="button" aria-pressed={theme === choice} className={`min-h-11 rounded-panel border px-3 ${theme === choice ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => setTheme(choice)}>
                        {theme === choice && <span aria-hidden="true">✓ </span>}{label}
                      </button>
                    );})}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="settings-reset-appearance"
                  className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => {
                    setTheme("dark");
                    setNotice("Theme reset to Dark.");
                  }}
                >
                  Reset theme
                </button>
                <p data-testid="settings-reset-appearance-status" className="mt-2 text-muted">Default theme: Dark.</p>
                <div className="settings-row mt-4">
                  <div>
                    <p className="font-semibold">Motion</p>
                    <p className="text-muted">Smooth uses the same easing on controls. Reduce turns that movement off in this browser. A device that asks for less motion still wins.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" aria-pressed={motionChoice === "smooth"} data-testid="settings-motion-smooth" className={`min-h-11 rounded-panel border px-3 ${motionChoice === "smooth" ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => chooseMotion("smooth")}>Smooth</button>
                    <button type="button" aria-pressed={motionChoice === "reduce"} data-testid="settings-motion-reduce" className={`min-h-11 rounded-panel border px-3 ${motionChoice === "reduce" ? "border-accent bg-accent text-accent-ink tile-active" : "border-line"}`} onClick={() => chooseMotion("reduce")}>Reduce</button>
                  </div>
                </div>
                <button type="button" data-testid="settings-show-steps" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { persistGuide(reopenFirstSteps()); setSettingsPane(null); setView("command"); setNavOpen(false); }}>
                  Show first steps
                </button>
              </div>
              {settingsPane === "connections" && <div id="settings-connections" className="space-y-4">
              <div className="settings-card rounded-panel p-4 text-sm">
                <p className="font-semibold">Provider failover</p>
                <p>Selected: {controlsModelLabel}{providerModels[effectiveProvider] ? " · " + providerModels[effectiveProvider] : ""}</p>
                <p className="mt-1 text-muted">
                  {failoverPolicy === "none"
                    ? "Off. Chat reports an unavailable provider and keeps the selected route."
                    : "On for eligible routes. An explicitly selected Gemini or free OpenRouter model keeps its route when unavailable."}
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
                <AiProviderConnections onChange={setCustomAiProviders} onUseModel={selectProviderInChat} />
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setSettingsPane("keys")}>Open Safe keys</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setView("connected")}>Open connections</button>
              </div>}
              {settingsPane === "keys" && <div id="settings-keys" className="space-y-4">
                <SafeKeysPanel key={account?.id ?? "guest"} />
              </div>}
              {settingsPane === "voice" && <div id="settings-voice">
                <VoiceSettingsBlock onReset={() => applyVoiceChoice(DEFAULT_XAI_VOICE)} />
                <SpeakPanel />
              </div>}
              <div id="settings-data" hidden={settingsPane !== "data"} className="space-y-4">
              <div className="settings-card rounded-panel p-4 text-sm">
                <div className="settings-row">
                  <div>
                    <p className="font-semibold">On this device</p>
                    <p className="text-muted">Workspace records: {formatBytes(storedBytes)}. Drafts and separately stored image bytes are excluded. {syncNote}</p>
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
                    requestProtected("overwrite", "server-copy", "Replace server copy", "The server copy will be replaced with the chats, notes, and files in this browser. Export a workspace archive first if you want a separate copy of this browser’s data.", "Replace server copy", run);
                  }}
                >
                  Save this browser copy over the server copy
                </button>
              )}
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
                    disabled={importChecking}
                    className="mt-1 block w-full text-sm"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void onImportFile(file);
                    }}
                  />
                </label>
                {importChecking && <p role="status" className="mt-2 text-sm text-muted">Checking archive…</p>}
                {importError && <p role="alert" className="mt-2 text-sm text-danger">{importError}</p>}
                {importStatus && <p role="status" className="mt-2 text-sm">{importStatus}</p>}
                {importPreview && (
                  <div className="mt-3 text-sm">
                    <p className="break-all font-semibold">{importPreview.name}</p>
                    <p className="mt-1 text-muted">Integrity check passed. Review the record counts before applying this archive.</p>
                    <table className="my-3 w-full text-left text-xs">
                      <thead><tr><th scope="col">Record</th><th scope="col">This device</th><th scope="col">Archive</th><th scope="col">Match</th></tr></thead>
                      <tbody>
                        {importCounts.map((row) => <tr className="border-t border-line" key={row.label}><th className="py-2" scope="row">{row.label}</th><td>{row.current}</td><td>{row.incoming}</td><td>{row.overlap}</td></tr>)}
                      </tbody>
                    </table>
                    <p className="mt-1 text-muted">Merge keeps {messagePreview?.kept} device-only messages in matching chats. For conflicting messages it keeps the device version. Conflicts in this archive: {messagePreview?.conflicts.join(", ") || "none"}.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => requestProtected("overwrite", "import-merge", "Merge this archive", "Merge records from the archive. For saved memory, corrections and deletions are preserved.", "Merge archive", () => { setWs((prev) => pushAudit(mergeWorkspace(prev, importPreview.workspace), "import_merge", "archive", "merged")); setImportPreview(null); setImportStatus("Archive merged with this workspace."); })}>
                        Merge
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-panel border border-line px-3"
                        onClick={() =>
                          requestProtected("overwrite", `import-replace:${importPreview.workspace.version}`, "Replace this workspace", "Current chats, notes, projects, and files are replaced by the archive.", "Approve replace", () => {
                            setWs((prev) => pushAudit(replaceFromArchive(prev, importPreview.workspace), "import_replace", "archive", "replaced"));
                            setImportPreview(null);
                            setImportStatus("Workspace replaced with the archive.");
                          })
                        }
                      >
                        Replace
                      </button>
                      <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setImportPreview(null)}>Cancel preview</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="settings-card rounded-panel p-4 text-sm">
                <p className="font-semibold">Clear this browser</p>
                <p className="mt-1 text-muted">Removes chats, notes, projects, files, and bots stored in this browser. The sign-in account, connected keys, and emergency stop stay. A paired computer is not deleted.</p>
                <button type="button" data-testid="wipe-browser-copy" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setWipeAsk(account?.id ?? null)}>
                  Clear browser copy
                </button>
                {wipeStatus ? <p data-testid="wipe-browser-status" role="status" className="mt-2 text-sm">{wipeStatus}</p> : null}
              </div>
              </div>
              <div id="settings-safety" hidden={settingsPane !== "safety"} className="space-y-4">
                <div className="settings-card rounded-panel p-4 text-sm">
                  <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-sm font-semibold" onClick={() => void toggleStop()}>
                    <Square className="size-4" /> {ws.halted ? "Clear emergency stop" : "Emergency stop"}
                  </button>
                  <p className="mt-2 text-muted">Stops new sends on this page and on the server.</p>
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
        <HandyDictation freeOnly={researchFreeOnly} />
      </main>
      {excerpt && excerpt.scope === draftScope && (
        <Overlay labelledBy="excerpt-title" onDismiss={() => setExcerpt(null)}>
          <div className="space-y-3">
            <h2 id="excerpt-title" className="font-semibold">Choose an excerpt from {excerpt.file.name}</h2>
            <p className="text-sm text-muted">Select up to {excerpt.limit.toLocaleString()} characters to send with this draft.</p>
            <textarea ref={excerptRef} aria-label="File excerpt" rows={8} readOnly value={excerpt.file.text} className="w-full rounded-panel border border-line bg-bg p-2" />
            <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => {
              const field = excerptRef.current;
              const selected = field?.value.slice(field.selectionStart, field.selectionEnd) ?? "";
              if (!selected.trim() || selected.length > excerpt.limit) {
                setError(`Select 1–${excerpt.limit} characters inside the file.`);
                return;
              }
              setStaged({ name: excerpt.file.name, text: selected }); setExcerpt(null); setError(null); setNotice("Selected excerpt attached.");
            }}>Attach selected text</button>
            <button type="button" className="min-h-11 rounded-panel px-3" onClick={() => setExcerpt(null)}>Cancel</button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Overlay>
      )}
      {imagineEdit && (
        <Overlay labelledBy="imagine-edit-title" onDismiss={() => { if (!busy) closeImagineEditor(); }}>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void runImagineEdit(imagineEdit.image, imagineEdit.text); }}>
            <h2 id="imagine-edit-title" className="text-lg font-semibold">Edit image with Imagine</h2>
            <img src={imagineEdit.result?.dataUrl ?? imagineEdit.image} alt="Selected image" className="max-h-40 w-full rounded-panel object-contain" />
            <label className="block text-sm">Describe the edit<textarea autoFocus rows={3} value={imagineEdit.text} onChange={(event) => { setImagineEdit({ ...imagineEdit, text: event.target.value }); setImagineEditError(null); }} className="mt-1 w-full rounded-panel border border-line bg-bg p-2" /></label>
            {imagineEdit.result && <button type="button" onClick={() => imagineEdit.result && downloadImageDataUrl(imagineEdit.result.dataUrl, imagineEdit.result.name || "edited")}>Download edited image</button>}
            {imagineEditError && <p role="alert" className="text-sm text-danger">{imagineEditError}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy || !imagineEdit.text.trim()} className="min-h-11 rounded-panel bg-accent px-3 text-sm text-accent-ink">{busy ? "Generating…" : "Generate edit"}</button>
              <button type="button" disabled={busy} onClick={closeImagineEditor} className="min-h-11 rounded-panel border border-line px-3 text-sm">Cancel edit</button>
            </div>
          </form>
        </Overlay>
      )}

      <input
        ref={fileRef}
        type="file"
        accept={view === "files" ? ".txt,.md,.json,.csv,.pdf,.js,.ts,.mjs,text/plain,application/pdf" : ".txt,.md,.json,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.js,.ts,.mjs,text/plain,application/pdf,image/*"}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onPicked(file, null).catch(() => setError("Couldn’t read this file. Choose another file to try again."));
        }}
      />
      <input
        ref={inspectFileRef} type="file" accept=".txt,.md,.json,.csv,.pdf,.js,.ts,.mjs,text/plain,application/pdf" className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onPicked(file, "research").catch(() => setError("Could not read the file for inspection."));
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
          setPendingImages((prev) => {
            if (prev.length >= 4) { setNotice(null); setError("The composer is full. Remove an attachment before capturing."); return prev; }
            setNotice(`Camera snapshot “${name}” attached to the composer.`);
            return [...prev, { dataUrl, name, mime: "image/jpeg", origin: "camera" }];
          });
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
            <Link to="/login" search={{ next: loginReturnPath() }} className="min-h-11 flex-1 rounded-panel bg-accent text-center leading-[2.75rem] font-semibold text-accent-ink">Sign in</Link>
          </div>
        </Overlay>
      )}
      {projectOpen && (
        <Overlay labelledBy="create-project-title" onDismiss={() => { setProjectName(""); setProjectAbout(""); setError(null); setProjectOpen(false); window.setTimeout(() => document.getElementById("new-project-button")?.focus(), 0); }}>
          <h3 id="create-project-title" className="font-display text-2xl font-bold">Create project</h3>
          <label className="mt-3 block text-sm font-medium" htmlFor="project-name">Project name <span className="text-muted">(required, up to {PROJECT_NAME_MAX} characters)</span></label>
          <input id="project-name" autoFocus required maxLength={PROJECT_NAME_MAX} value={projectName} onChange={(event) => { setProjectName(event.target.value); if (error === "Name the project.") setError(null); }} placeholder="Name" aria-describedby={error === "Name the project." ? "project-name-error" : undefined} className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
          {error === "Name the project." ? <p id="project-name-error" role="alert" className="mt-2 text-sm text-danger">Enter a project name before creating it.</p> : null}
          <label className="mt-3 block text-sm font-medium" htmlFor="project-description">Description <span className="text-muted">(optional, up to 400 characters)</span></label>
          <textarea id="project-description" maxLength={400} value={projectAbout} onChange={(event) => setProjectAbout(event.target.value)} placeholder="What belongs in this project?" rows={3} className="mt-1 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => { setProjectName(""); setProjectAbout(""); setError(null); setProjectOpen(false); window.setTimeout(() => document.getElementById("new-project-button")?.focus(), 0); }}>Cancel</button>
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
      {wipeAsk && wipeAsk === account?.id && (
        <Overlay labelledBy="wipe-browser-title" onDismiss={() => setWipeAsk(null)}>
          <h3 id="wipe-browser-title" className="font-display text-2xl font-bold">Clear this browser copy?</h3>
          <p className="mt-2 text-sm text-muted">Chats, notes, projects, files, and bots in this browser are removed. Your server copy stays available. The sign-in account, connected keys, and emergency stop stay. A paired computer is not deleted.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => setWipeAsk(null)}>Keep data</button>
            <button
              type="button"
              data-testid="confirm-wipe-browser"
              className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink"
              onClick={() => {
                const next = clearedBrowserCopy(wsRef.current);
                setWipeAsk(null);
                setActiveId(null);
                setWipeStatus("Clearing this browser copy…");
                void clearStoredCopy(next).then((message) => {
                  setWipeStatus(message);
                  setNotice(message);
                });
              }}
            >
              Clear browser copy
            </button>
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
        onRetry={overlayError && !speakCanRetry(presentVoiceCopy(overlayError)) ? undefined : () => void retryVoiceOverlay()}
      />
      <SpeakStage
        open={speakStageOpen}
        freeOnly={researchFreeOnly}
        signedIn={statusSignedIn === true || (typeof window !== "undefined" && (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"))}
        live={voiceListening}
        onClose={closeSpeakStage}
        onKeepRecording={keepTaskRecording}
        onHandCode={(text) => handToHumanCode(text, "From Speak")}
        onStyle={(style) => {
          const personalityId = speakStylePersonality(style);
          if (activeId) setWs((prev) => updateChatPersonality(prev, activeId, personalityId));
          setNotice(`${style} is saved as the personality. The voice name is separate.`);
        }}
        onSignIn={() => { setSpeakStageOpen(false); window.location.assign("/login?next=" + encodeURIComponent(loginReturnPath(true))); }}
        recording={taskRecording}
        onVoice={applyVoiceChoice}
        micMuted={voiceMuted}
        onMicMute={setVoiceMicMuted}
        onLive={() => {
          setSpeakCall((current) => ({ ...current, error: "" }));
          return listen({ mode: "start" });
        }}
        heard={speakCall.heard}
        spoken={speakCall.reply}
        callError={speakCall.error}
        halted={ws.halted}
        onEmergencyStop={() => { void pressEmergencyStop(); }}
        onClearStop={() => { void clearEmergencyStop(); }}
        onAsk={async (text) => {
          const blocked = decideComputerAction({ text, halted: wsRef.current.halted === true, paired: false, actor: "eve" });
          if (blocked.kind !== "none") return { error: blocked.message };
          const turn = await speakChatTurn(text);
          if (!turn.ok) return { error: turn.error };
          if (!speakStageOpenRef.current || wsRef.current.halted) return { reply: turn.text, error: "Call ended before playback." };
          const spoken = await speak(turn.text);
          if (!spoken?.ok) return { reply: turn.text, error: spoken?.error || "The reply was written, but it was not spoken." };
          return { reply: turn.text };
        }}
      />
      {taskRecording ? (
        <div className="fixed left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-3 rounded-panel border border-line bg-surface px-4 py-2 shadow-lg" data-testid="task-recording" role="status">
          <span className="text-sm">Recording this tab · {taskSeconds}s. Closing this tab stops it. It cannot continue after the tab closes.</span>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void stopTaskRecording()}>Stop</button>
        </div>
      ) : null}
      <LiveVoiceBar
        freeOnly={researchFreeOnly}
        compactIdle
        authReady={statusSignedIn === true}
        authSignedIn={statusSignedIn === true}
        onSignInRequired={() => setVoiceSignInNotice(true)}
        onCompactSpeak={openSpeakStage}
        onChatAttachImage={(image) => setPendingImages((prev) => prev.length >= 4 ? prev : [...prev, image])}
        onDictateToggle={onDictationMic}
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
        onUserTranscript={(text) => appendLiveTranscript("user", text)}
        onAssistantTranscript={(text) => appendLiveTranscript("assistant", text)}
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

function Overlay({ children, labelledBy, onDismiss }: { children: ReactNode; labelledBy?: string; onDismiss?: () => void }) {
  return (
    <div className="overlay-backdrop fixed inset-0 z-40 grid place-items-end p-4 md:place-items-center" role="dialog" aria-modal="false" aria-labelledby={labelledBy} ref={(node) => {
      node?.style.setProperty("background", "transparent", "important");
      node?.style.setProperty("backdrop-filter", "none", "important");
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && onDismiss) { event.preventDefault(); onDismiss(); return; }
      if (event.key !== "Tab") return;
      const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => element.offsetParent !== null);
      if (targets.length === 0) return;
      const first = targets[0]!;
      const last = targets.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div ref={finishMenu} className="overlay-panel w-full max-w-md">{children}</div>
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
  chatSettingsOpen,
  onChatSettingsToggle,
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
  notice,
  setDraft,
  onPickModule,
  onPick,
  onSend,
  cue,
  onDropCue,
  onReleaseCue,
  canStop,
  onStop,
  onRename,
  onEdit,
  onRegenerate,
  onRetry,
  onExport,
  onDelete,
  onDeleteChat,
  onDeleteSection,
  projects = [],
  pinnedIds = [],
  scheduledChatIds = [],
  onConversationAction,
  onSave,
  onNew,
 onSpeak,
  onStopSpeak,
 onOpenSpeak,
  onOpenBuild,
  onOpenHuman,
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
  consultModules,
  consultModel,
  onConsultModel,
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
  driveConnected = false,
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
  chatSettingsOpen: boolean;
  onChatSettingsToggle: (open: boolean) => void;
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
  notice: string | null;
  setDraft: (value: string) => void;
  onPickModule?: (item: ModuleSuggestion) => void;
  onPick: (id: string) => void;
  onSend: () => void;
  cue: CuedMessage[];
  onDropCue: (id: string) => void;
  onReleaseCue: () => void;
  canStop: boolean;
  onStop: () => void;
  onRename: (title: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onExport: (textOnly?: boolean) => void;
  onDelete: () => void;
  onDeleteChat?: (id: string, title: string) => void;
  onDeleteSection?: (label: string, ids: string[]) => void;
  projects?: { id: string; name: string }[];
  pinnedIds?: string[];
  scheduledChatIds?: string[];
  onConversationAction?: (action: ConversationAction, ids: string[], extra?: { projectId?: string | null; title?: string }) => void;
  onSave: (content: string) => void;
  onNew: () => void;
 onSpeak: (text: string, messageId?: string) => void;
  onStopSpeak?: () => void;
 onOpenSpeak?: () => void;
  onOpenBuild: (text: string) => void;
  onOpenHuman: (text: string) => void;
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
  consultModules?: ConsultModule[];
  consultModel?: string;
  onConsultModel?: (id: string) => void;
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
  driveConnected?: boolean;
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
  onViewAudit: (auditId: string | null) => void;
}) {
  const [filter, setFilter] = useState("");
  const [tools, setTools] = useState(false);
  const [context, setContext] = useState(false);
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
  const grokVerified = Boolean(active?.messages.some((message) => message.role === "assistant" && /^(grok|xai)$/i.test(message.provider ?? "")));
  const chatRoute = routeForBotChat(active, { provider: providerChoice, modelTier });
  const routeId = chatRoute.fromBot ? chatRoute.provider : logicRoute ?? chatRoute.provider;
  const routeLabel = choices.find((choice) => choice.id === routeId)?.label
    ?? logicRoutes.find((route) => route.id === routeId)?.label
    ?? "Selected module unavailable";
  const needle = filter.trim().toLowerCase();
  const scoped = projectId ? chats.filter((chat) => chat.projectId === projectId) : chats;
  const visible = needle ? scoped.filter((chat) => chat.title.toLowerCase().includes(needle)) : scoped;
  const groups = ["Today", "Yesterday", "This week", "Earlier"]
    .map((label) => ({ label, items: visible.filter((chat) => chatBucket(chat) === label) }))
    .filter((group) => group.items.length > 0);
  const transcript = useRef<HTMLDivElement>(null);
  const turns = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previousScrollTop = useRef(0);
  const [detached, setDetached] = useState(false);

  useLayoutEffect(() => {
    const pane = transcript.current;
    const content = turns.current;
    if (!pane || !content) return;
    following.current = true;
    setDetached(false);
    function followTail() {
      if (pane && following.current) {
        pane.scrollTop = pane.scrollHeight;
        previousScrollTop.current = pane.scrollTop;
      }
    }
    followTail();
    const observer = new ResizeObserver(followTail);
    observer.observe(content);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [active?.id]);
  const lastReply = [...(active?.messages ?? [])].reverse().find((msg) => msg.role === "assistant");
  return (
    <div id="chat-thread" className="thread-shell flex h-full min-h-0 flex-col xl:flex-row">
      {!active?.messages.length ? <aside className="flex max-h-72 shrink-0 flex-col border-b border-line xl:max-h-none xl:w-64 xl:border-r xl:border-b-0" data-testid="thread-history">
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
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by chat title" className="min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" aria-label="Search conversations" />
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-3">
          {groups.length === 0 && <p className="text-sm text-muted">{scoped.length === 0 ? (projectName ? `No chats for ${projectName} yet.` : "No conversations yet.") : "No titles match. Use workspace search to find message text."}</p>}
          {onConversationAction && (
            <ConversationSections
              chats={visible}
              activeId={active?.id}
              projects={projects}
              pinnedIds={pinnedIds}
              scheduledChatIds={scheduledChatIds}
              onOpen={onPick}
              onAction={onConversationAction}
              extras={(ids) => (active && ids.length === 1 && ids[0] === active.id ? [{ label: "Download text transcript", onPick: () => onExport(true) }, { label: "Download transcript JSON with attachments", onPick: () => onExport(false) }] : [])}
            />
          )}
        </div>
      </aside>
      : null}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="chat-head px-4 pt-4" hidden={Boolean(active?.messages.length)}>
          <h2 className="font-display text-3xl font-bold">{active?.title || "AI Chat"}</h2>
         {active && customPersonality.trim() ? <p className="mt-1 text-sm text-muted">{active.title} is open in Chat. Its saved instructions are used for the next reply.</p> : null}
          {active?.temporary && <div className="text-xs text-muted">Excluded from workspace archives by default</div>}
          {active?.messages.some((message) => message.images?.some((image) => !image.dataUrl)) && <div className="text-xs text-muted">Some images are unavailable. Their references will be included in the transcript.</div>}
          <details className="thread-mobile-tools mt-3">
            <summary className="min-h-11 cursor-pointer text-sm">Provider</summary>
            <ProviderPicker name="mind-provider-mobile" choices={choices} choice={providerChoice} onChoose={onProvider} logicRoutes={logicRoutes} grokVerified={grokVerified} />
            <div className="mt-3">
              {routeId === "grok" && <ModelTierPicker name="mind-tier-mobile" tier={modelTier} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />}
            </div>
          </details>
        </div>
        <details id="thread-chat-settings" className="thread-chat-settings" open={chatSettingsOpen} onToggle={(event) => onChatSettingsToggle(event.currentTarget.open)}>
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
              <label htmlFor="thread-custom-personality" className="text-xs font-semibold text-muted">Persona instructions</label>
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
        <div ref={transcript} className="min-h-0 flex-1 overflow-auto p-4" onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement && event.target.matches("article.turn[id^='message-']")) {
            following.current = false;
            setDetached(true);
          }
        }} onScroll={(event) => {
          const pane = event.currentTarget;
          const end = Math.max(0, pane.scrollHeight - pane.clientHeight);
          const top = pane.scrollTop;
          // Growing content can increase the distance from the tail before its resize callback.
          // Only an actual upward scroll should detach a reader who was following.
          if (end - top < 32) following.current = true;
          else if (top < Math.min(previousScrollTop.current, end) - 1) following.current = false;
          previousScrollTop.current = top;
          setDetached(!following.current);
        }}>
          <div ref={turns} className="space-y-3">
          <ChatMediaGallery messages={active?.messages} onUseInComposer={onSaveImage} onEditImagine={onEditImagine} onDownload={onDownloadImage} />
          {(!active || active.messages.length === 0) && !busy && (
            <div className="grid min-h-64 place-items-center text-center">
              <ChatEmptyHero
                title={chatRoute.fromBot ? `${routeLabel} · ${chatRoute.modelTier}` : routeLabel}
                subtitle={active?.agentId ? "This conversation belongs to the bot." : undefined}
              />
            </div>
          )}
          {active?.messages.map((msg) => {
            const last = active.messages.at(-1);
            return (
            <article key={msg.id} id={"message-" + msg.id} tabIndex={-1} className={`turn w-full max-w-none px-1 py-2 text-sm ${msg.role === "user" ? "turn-user" : "turn-assistant"}`}>
              <p className="mb-1 text-xs text-muted">{msg.role === "user" ? "You" : [msg.provider, msg.model].filter(Boolean).join(" · ") || "Assistant · model unreported"} · {stamp(msg.at)}</p>
              {msg.requestedModel && msg.model !== msg.requestedModel && (
                <p className="mb-1 break-words text-xs text-muted">Requested {msg.requestedModel}</p>
              )}
              {msg.delivery && !(busy && msg.delivery === "submitted" && last?.id === msg.id) && (
                <p className="mb-1 text-xs text-muted" role="status">
                  {msg.deliveryRoute && <span>{msg.deliveryRoute.provider} · {msg.deliveryRoute.model ?? msg.deliveryRoute.tier}. </span>}
                  {msg.delivery === "stopped" ? STOPPED_REPLY : msg.delivery === "failed" ? "The provider did not complete this reply." : "No finished reply was saved. The provider may already have received this message."}
                </p>
              )}
              {editingId === msg.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onEdit(msg.id, editDraft);
                    setEditingId(null);
                  }}
                >
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} className="w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
                  <p className="mt-1 text-xs text-muted">This starts a new conversation from this message. Your original conversation stays intact.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="submit" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" disabled={!editDraft.trim() || busy}>Send as new branch</button>
                    <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  {msg.role === "assistant" ? <AnswerTabs text={msg.content} images={msg.images} onEditImagine={(src) => onEditImagine(src)} onSaveImage={onSaveImage} onDownloadImage={onDownloadImage} /> : <MessageBody text={msg.content} images={msg.images} onEditImagine={(src) => onEditImagine(src)} onSaveImage={onSaveImage} onDownloadImage={onDownloadImage} />}
                  {msg.videoUrl ? <video className="owner-video mt-2" src={msg.videoUrl} controls playsInline preload="metadata" /> : null}
                </>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Reply actions">
                {msg.kind === "error" ? (
                  <>
                    <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={onRetry}>Retry</button>
                    <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={() => onViewAudit(null)}>View log</button>
                    <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={(event) => event.currentTarget.closest("article")?.setAttribute("hidden", "")}>Dismiss</button>
                  </>
                ) : null}
                {msg.kind === "error" ? null : <>
                <button
                  type="button"
                  className="min-h-11 rounded-full px-3 text-xs"
                  onClick={() => {
                    void navigator.clipboard?.writeText(msg.content).then(() => {
                      setCopiedId(msg.id);
                    }).catch(() => setCopiedId(null));
                  }}
                >
                  {copiedId === msg.id ? "Copied" : "Copy"}
                </button>
                {msg.role === "assistant" && (
                  <button type="button" className="chat-button chat-button--ghost" onClick={() => (speaking ? onStopSpeak?.() : onSpeak(msg.content, msg.id))}>
                    <Volume2 size={20} strokeWidth={1.75} /> {replyActions({ role: "assistant", busy: false, speaking, hasSources: replyHasSources(msg.content) }).includes("stop-playback") ? "Stop" : "Read aloud"}
                  </button>
                )}
                {msg.role === "assistant" && last?.id === msg.id && (
                  <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={onRegenerate} disabled={busy || halted}>
                    Regenerate
                  </button>
                )}
                {msg.role === "assistant" && (
                  <details className="relative">
                    <summary className="chat-button chat-button--ghost" aria-label="More">⋯</summary>
                    <div className="absolute bottom-12 left-0 z-20 flex min-w-44 flex-col rounded-2xl border border-line bg-bg p-1">
                      {!active.temporary && <label className="px-3 py-2 text-xs">Rate this reply
                        <select aria-label="Rate this reply" value={ratings.find((rating) => rating.messageId === msg.id)?.score ?? ""} onChange={(event) => {
                          const score = Number(event.target.value);
                          if (score >= 1 && score <= 5) onRate(msg.id, score as 1 | 2 | 3 | 4 | 5, msg.model ?? null);
                        }}>
                          <option value="" disabled>Choose rating</option>
                          {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}
                        </select>
                      </label>}
                      <button type="button" className="min-h-11 px-3 text-left text-xs" onClick={() => onOpenBuild(msg.content)}>Open in Build</button>
                      <button type="button" className="min-h-11 px-3 text-left text-xs" onClick={() => onOpenHuman(msg.content)}>Open in Intelligence</button>
                      {replyHasSources(msg.content) ? <p className="px-3 py-2 text-xs">Sources: {msg.content.match(/https?:\/\/\S+/g)?.join(" ")}</p> : null}
                      <p className="px-3 py-2 text-xs">Type list capabilities. Device actions are not verified until the PC or phone runs them.</p>
                    </div>
                  </details>
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
                </>}
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
            <div className="w-full max-w-none rounded-panel border border-line bg-surface p-3" data-testid="executing-tools">
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
          {error && <p className="rounded-panel border border-line bg-surface px-3 py-2 text-sm text-danger" role="status">{error}</p>}
          {busy && liveText && (
            <article className="turn turn-assistant w-full max-w-none px-1 py-2 text-sm">
              <p className="mb-1 text-xs text-muted">{modelTier} · writing</p>
              <p className="whitespace-pre-wrap">{liveText}</p>
            </article>
          )}
          {busy && !liveText && toolTimeline.length === 0 && (
            <div className="turn turn-assistant w-full max-w-none space-y-2 px-1 py-2" aria-live="polite">
              <p className="text-xs text-muted">{active?.messages.at(-1)?.content.startsWith("/video") ? "Rendering the video." : active?.messages.at(-1)?.content.startsWith("/imagine") ? "Creating the image." : "Waiting for the selected provider."}</p>
              <div className="skeleton h-3" style={{ width: "75%" }} />
              <div className="skeleton h-3" style={{ width: "50%" }} />
              <div className="skeleton h-3" style={{ width: "66%" }} />
            </div>
          )}
          {voiceListening ? <div className="flex items-center gap-2"><VoiceLevelMeter level={voiceLevel} listening={voiceListening} /></div> : null}
        </div>
        </div>
        {detached && <button type="button" className="jump-to-latest" onClick={() => {
          following.current = true;
          setDetached(false);
          if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
        }}>Jump to latest</button>}
        {cue.length > 0 ? (
          <div className="rounded-panel border border-line p-2" data-testid="message-cue">
            <p className="text-xs uppercase tracking-wide text-muted">Next</p>
            <ol className="space-y-1">
              {cue.map((item, index) => (
                <li
                  key={item.id}
                  className="min-w-0"
                  data-testid="cued-message"
                  onPointerDown={(event) => {
                    const timer = window.setTimeout(() => onDropCue(item.id), 550);
                    event.currentTarget.dataset.hold = String(timer);
                  }}
                  onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                  onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                  onPointerCancel={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
                >
                  <span className="block break-words text-sm">{index + 1}. {item.text}</span>
                </li>
              ))}
            </ol>
            {notice ? <p className="mt-1 text-sm text-muted" role="status" data-testid="cue-notice">{notice}</p> : null}
            {!busy ? <button type="button" className="mt-1 min-h-11 px-2 text-sm text-accent" onClick={onReleaseCue}>Send next</button> : null}
          </div>
        ) : null}
        {lastReply ? (
          <div className="next-guesses px-3 pb-1" data-testid="next-guesses">
            <button type="button" className="suggestion-chip shrink-0" onClick={() => setDraft("Go deeper on that")}>Go deeper</button>
            <button type="button" className="suggestion-chip shrink-0" onClick={() => setDraft("Make that shorter")}>Make it shorter</button>
            {lastReply?.kind === "error" || lastReply?.content.startsWith("/imagine") ? null : <button type="button" className="suggestion-chip shrink-0" onClick={() => setDraft("Turn that into an image")}>Make an image</button>}
          </div>
        ) : null}
        <form
          className="floating-composer command-card composer-dock thread-composer p-3" data-composer="floating"
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
          {canStop && (
            <div className="mb-2 flex justify-end">
              <button type="button" className="chat-pill min-h-11 border border-line px-3 text-sm" data-testid="stop-reply" onClick={onStop}>Stop this reply</button>
            </div>
          )}
          <div className="thread-draft">
          {onPickModule && (!active || active.messages.length === 0) ? <ModuleSuggestions draft={draft} onPick={onPickModule} /> : null}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
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
            placeholder={`Message (${active?.botTier ?? modelTier})...`}
            aria-label="Message"
            rows={2}
            className="input-glow min-h-11 w-full resize-none rounded-xl bg-transparent px-1 text-sm outline-none"
          />
          {active?.botKnowledge ? <p className="mt-1 text-xs text-muted">This chat sends its copied bot note. Saved memory stays off.</p> : null}
          {active?.botProvider || active?.botTier ? <p className="mt-1 text-xs text-muted">This chat uses {active.botProvider ?? "Chat’s provider"} · {active.botTier ?? "Chat’s tier"}. The picker above is not changed.</p> : null}
          <AttachmentChips images={pendingImages} onRemove={onRemoveImage} onEditImagine={(image) => onEditImagine(image.dataUrl)} />
          {stagedName && <p className="text-xs text-muted">Staged: {stagedName}. Send includes it. Analyze runs REA on it.</p>}
          {context && (
            <p className="mt-2 text-xs text-muted">
              Memory is {memoryChoice}. {memoryChoice === "off" ? (active?.botKnowledge ? "Saved memory stays off. This chat still sends its copied bot note and does not read other notes." : "This chat cannot read or save notes.") : "This chat can read notes in its scope."} Mode is {mode === "ask" ? "Ask" : "Automatic"}. Deletes still ask you.
            </p>
          )}
          {tools && (
            <div className="mt-2 rounded-panel border border-line bg-bg p-3 text-sm">
              <MenuCluster label="Inspect">
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-left text-sm" style={menuChip} onClick={onDoctor}>Run REA doctor</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-left text-sm" style={menuChip} onClick={onAnalyze}>Inspect a file with REA</button>
              </MenuCluster>
              <p className="text-xs text-muted">Chat stays on Grok. Imagine generates images via grok-imagine-image. Video is not called.</p>
            </div>
          )}
          </div>
          <div className="composer-toolbar mt-2 flex flex-wrap items-center gap-2">
            <ComposerMore testId="composer-more-menu">
                <MenuCluster label="Files">
                  <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={onAttach}>
                    <Paperclip className="size-4" /> Attach
                  </button>
                  <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={onAttachImage}>
                    <Image className="size-4" /> Image
                  </button>
                  <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={onOpenCamera}>
                    <Camera className="size-4" /> Camera
                  </button>
                  {driveConnected ? (
                    <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={onOpenCloud}>
                      Drive
                    </button>
                  ) : null}
                </MenuCluster>
                <MenuCluster label="Create">
                  <button type="button" className="inline-flex items-center gap-2 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} disabled={busy || halted} onClick={onImagine}>
                    Imagine
                  </button>
                </MenuCluster>
                <MenuCluster label="Workspace">
                  <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={() => { setTools(false); setContext((open) => !open); document.querySelectorAll("details.composer-more[open]").forEach((node) => node.removeAttribute("open")); }}>Add Context</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={() => { setContext(false); setTools((open) => !open); document.querySelectorAll("details.composer-more[open]").forEach((node) => node.removeAttribute("open")); }}>Tools</button>
                </MenuCluster>
                <MenuCluster label="Chat" wide>
                  <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={onDelete} disabled={!active}>Delete</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" style={menuChip} onClick={() => onMemoryChange(memoryChoice === "on" ? "off" : "on")} disabled={!active || busy || halted} aria-label={memoryChoice === "on" ? "Memory on for this chat" : "Don't use memory for this chat"}>{memoryChoice === "on" ? "Memory on" : "Memory off"}</button>
                  <ComposerEffortControl mode={composerEffort} onChoose={onComposerEffort} consultModules={consultModules} consultModel={consultModel} onConsultModel={onConsultModel} />
                  <label className="inline-flex min-h-11 items-center gap-2 text-xs text-muted" style={{ flex: "1 1 12rem", maxWidth: "100%" }}>
                    Style
                    <select aria-label="Conversation style" value={personalityId} disabled={!active || busy} onChange={(event) => onPersonalityChange(event.target.value as PersonalityId)} className="min-h-11 rounded-panel border border-line bg-transparent px-2 text-sm text-fg">
                      {CONVERSATIONAL_PERSONALITIES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                    </select>
                  </label>
                </MenuCluster>
            </ComposerMore>
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
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" disabled={!lastReply && !speaking} onClick={() => (speaking ? onStopSpeak?.() : lastReply && onSpeak(lastReply.content, lastReply.id))}>
              {speaking ? "Stop" : "Read aloud"}
            </button></div>
            
            <button type={busy ? "button" : "submit"} onClick={busy ? onStop : undefined} disabled={halted || (!busy && !draft.trim() && pendingImages.length === 0 && !stagedName)} className="composer-send min-h-11 min-w-16 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">{busy ? "Stop" : "Send"}</button>
            <button type="button" className="composer-mic-dictate inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm" data-testid="composer-mic-dictate" aria-label="Mic" title="Mic types into the field. It does not open Speak." onClick={onDictationMic}>
              <Mic className="size-4" /> Mic
            </button>
            <button type="button" className="gpt-voice inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2f6bff] px-3 text-sm text-white" aria-label="Speak" title="Speak is the call. It does not type into the field." onClick={() => onOpenSpeak?.()}>
              <Volume2 className="size-4" /> Speak
            </button>
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
            {routeId === "grok" && <ModelTierPicker name="mind-tier-side" tier={modelTier} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />}
          </section>
        </details>
        <details className="rail-pack">
          <summary>This chat</summary>
          <section className="glass-panel rounded-panel p-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onComposerMode("ask")} className={`min-h-11 rounded-panel px-3 text-left text-sm ${mode === "ask" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80"}`} style={menuChip}>Ask</button>
            <button type="button" onClick={() => onComposerMode("automatic")} className={`min-h-11 rounded-panel px-3 text-left text-sm ${mode === "automatic" ? "bg-accent text-accent-ink tile-active" : "bg-surface-2/80"}`} style={menuChip}>Automatic</button>
          </div>
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
        {connectedServices.some((item) => item.tone === "ok") || systemStatus.rows.some((row) => row.ok) ? (
        <details className="rail-pack">
          <summary>Connections</summary>
          <section className="glass-panel rounded-panel p-3 text-sm" data-testid="connected-services-rail">
          <p className="font-semibold">Connected Services</p>
          <ul className="mt-2 space-y-2">
            {connectedServices.filter((item) => item.tone === "ok").map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-2 text-xs">
                <span>{item.name}</span>
                <span className={item.tone === "ok" ? "text-ok" : item.tone === "danger" ? "text-danger" : "text-muted"}>{item.state}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass-panel rounded-panel p-3 text-sm" data-testid="system-status-rail">
          <p className="font-semibold">System Status</p>
          <ul className="mt-2 space-y-2">
            {systemStatus.rows.filter((row) => row.ok).map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-2 text-xs">
                <span>{row.name}</span>
                <span className={row.ok ? "text-ok" : "text-muted"}>{row.state}</span>
              </li>
            ))}
          </ul>
        </section>
        </details>
        ) : null}
        <section className="glass-panel rounded-panel p-3 text-sm">
          <p className="font-semibold">{active?.title ?? "New session"}</p>
          <p className="text-xs text-muted">On this device · Memory {memoryChoice}</p>
        </section>
        <div className={`voice-zone-rail ${speaking ? "is-live" : ""}`} aria-label="Voice controls">
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line/80 px-3 text-sm" onClick={onDictationMic} aria-label="Mic" title="Mic types into the field. It does not open Speak.">
            <Mic className="size-4" /> Mic
          </button>
          <span className="waveform" aria-hidden="true"><span /><span /><span /><span /><span /></span>
          <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line/80 px-3 text-sm" onClick={() => onOpenSpeak?.()} aria-label="Speak" title="Speak is the call. It does not type into the field.">
            <Volume2 className="size-4" /> Speak
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
  consultModules = [],
  consultModel = "",
  onConsultModel,
}: {
  mode: ComposerModeId;
  onChoose: (mode: ComposerModeId) => void;
  consultModules?: ConsultModule[];
  consultModel?: string;
  onConsultModel?: (id: string) => void;
}) {
  const resolved = resolveSendPath(mode);
  const current = COMPOSER_MODES.find((item) => item.id === mode) ?? COMPOSER_MODES[0];
  const connected = consultModules.filter((item) => item.connected);
  return (
    <div className="composer-effort" data-testid="composer-effort">
      <label className="composer-effort-field">
        <span>Effort</span>
        <select value={mode} onChange={(event) => onChoose(event.target.value as ComposerModeId)}>
          {COMPOSER_MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <p className="composer-effort-description">
        {current?.detail}
        {resolved.notice ? ` ${resolved.notice}` : ""}
      </p>
      {mode === "orchestrator" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="orchestrator-models">
          <span className="text-xs text-muted">Orchestrator model</span>
          {connected.length === 0 ? <span className="text-xs text-muted">No model is connected right now. Connect one, then choose it.</span> : null}
          {connected.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="consult-model"
              aria-pressed={consultModel === item.id}
              className={`min-h-11 rounded-full px-3 text-sm ${consultModel === item.id ? "bg-accent text-accent-ink tile-active" : "border border-line/80 bg-white/5 text-muted"}`}
              onClick={() => onConsultModel?.(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
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

function VoiceSettingsBlock({ onReset }: { onReset: () => void }) {
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
      <button
        type="button"
        data-testid="settings-reset-voice"
        className="mt-3 min-h-11 rounded-panel border border-line px-3"
        onClick={() => {
          const storage = typeof localStorage === "undefined" ? null : localStorage;
          resetVoice(storage);
          setSettings({ ...DEFAULT_VOICE_SETTINGS });
          onReset();
        }}
      >
        Reset to defaults
      </button>
      <p data-testid="settings-reset-voice-status" className="mt-2 text-muted">Defaults are Eve, Adrian, default activation, and normal pace.</p>
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
      <p className="text-xs text-muted">These modes use the Grok key already saved on this computer.</p>
      {MODEL_TIERS.map((item) => (
        <label key={item} className="flex items-start gap-2 text-sm">
          <input type="radio" name={name} checked={logicRoute == null && tier === item} onChange={() => onChoose(item)} className="mt-1" />
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
  const visible = [
    ...choices,
    ...logicRoutes.filter((route) => route.ready).map((route) => ({ id: route.id, label: route.label, enabled: true, reason: route.reason })),
  ];
  const seen = new Set<string>();
  const groups = new Map<string, { title: string; items: typeof choices }>();
  for (const item of visible) {
    if (!item.enabled || seen.has(item.id)) continue;
    seen.add(item.id);
    const [kind, source] = item.id.split(":");
    const external = kind === "custom" || kind === "mcp";
    const groupId = external ? `${kind}:${source}` : kind === "service" ? "services" : item.id;
    const title = external ? item.label.split(": ")[0] : kind === "service" ? "Connected services" : item.label;
    const group = groups.get(groupId) ?? { title, items: [] };
    group.items.push(item);
    groups.set(groupId, group);
  }
  const selected = visible.find((item) => item.id === choice);
  return (
    <div className="provider-pack">
      <p className="text-sm font-semibold">Providers</p>
      <p className="mt-1 text-xs text-muted">{selected ? selected.label : "Choose a provider"}</p>
      {Array.from(groups, ([groupId, group]) => (
        <details key={groupId} className="provider-group" open={group.items.some((item) => item.id === choice) || undefined}>
          <summary className="flex items-center gap-2">
            {PRODUCT_LOGO[group.title.toLowerCase()] ? <img src={PRODUCT_LOGO[group.title.toLowerCase()]} alt="" width={16} height={16} className="size-4 rounded" /> : null}
            {group.title}
            {groupId.startsWith("custom:") ? <span className="text-xs text-muted">{group.items.length} {group.items.length === 1 ? "model" : "models"}</span> : null}
          </summary>
          <div className="max-h-64 overflow-y-auto overflow-x-hidden">
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
          </div>
        </details>
      ))}
    </div>
  );
}

function chatBucket(chat: Chat) {
  return conversationSection(chat);
}

function chatStamp(chat: Chat) {
  const iso = chat.messages.at(-1)?.at ?? chat.messages[0]?.at;
  if (!iso) return "New";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
