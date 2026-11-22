import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useSyncExternalStore } from "react";
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
import { consumeMindTurn, shouldStoreReply, STOPPED_REPLY } from "@/lib/mind/live-turn";
import { analyzeImageFile, createVoiceClientSecret, mcpCommand, mcpList, mcpRemove, mcpRegistryList, mcpRegistryToggle, mcpSave, mindStatus, notionCommand, notionDisconnect, notionStatus, recordAgentExecution, searchWeb, setExecutionHalt, speakText } from "@/lib/mind/server";
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
import { speakCanRetry } from "@/lib/mind/voice/speak-failures";
import { interruptMessageSpeak } from "@/lib/mind/voice/speak-control";
import { replyVoiceForTurn, shouldSpeakTranscriptAgain } from "@/lib/mind/voice/one-voice";
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
import { listChatGalleryImages } from "@/lib/mind/media/chat-gallery";
import { fileToDownscaledDataUrl } from "@/components/mind/media/downscale";
import { historyTextForImages, parseImagineCommand, toImageAttachments, type ImageAttachment } from "@/lib/mind/media";
import { haltFleet, enqueueRun, runDueSchedules, togglePin } from "@/lib/mind/fleet";
import { tickFleet } from "@/lib/mind/fleet";
import { createBotFromSpeech, parseCreateBot } from "@/lib/mind/speak-bot";
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
import { AnchoredCard, MenuCluster, MenuGroup, MenuMotion, MenuShelf, finishMenu, menuChip, pinComposerMenu, pinShelf } from "@/components/mind/menu-material";
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
import { HandyDictation } from "@/components/mind/handy-dictation";
import { detectWithHandy } from "@/lib/mind/handy-dictation";
import { ModuleSuggestions } from "@/components/mind/module-suggestions";
import { type ModuleSuggestion } from "@/lib/intent/module-suggestions";
import { refreshSkills } from "@/lib/mind/skill-refresh";
import { exportChat, prepareRegenerate, prepareRetry, renameChat, reviseUserTurn } from "@/lib/mind/transcript";
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
  mcpToolFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "@/lib/mind/failure-states";
import { eveAccessNotes } from "@/lib/mind/eve-access";
import { createTaskRecorder, recordingEndsWithDocument } from "@/lib/mind/task-recording";
import { decideComputerAction } from "@/lib/mind/computer-control";
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
  clearedBrowserCopy,
  createChat,
  openBotChat,
  loadWorkspace,
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
  node.style.setProperty("padding-bottom", `${gap}px`, "important");
}
function showRailLabel(node: HTMLElement | null) {
  node?.style.setProperty("display", "block", "important");
}
function liftHomeComposer(node: HTMLElement | null) {
  if (!node) return;
  node.style.setProperty("position", "relative", "important");
  node.style.setProperty("bottom", "auto", "important");
  node.style.setProperty("left", "0", "important");
  node.style.setProperty("right", "auto", "important");
  node.style.setProperty("z-index", "1", "important");
  node.style.setProperty("width", "100%", "important");
  node.style.setProperty("max-width", "100%", "important");
  node.style.setProperty("min-width", "0", "important");
  node.style.setProperty("overflow", "hidden", "important");
  node.style.setProperty("transform", "none", "important");
  node.style.setProperty("box-sizing", "border-box", "important");
  keepComposerInside();
}
function liftHomeStack(node: HTMLElement | null) {
  node?.style.setProperty("justify-content", "flex-start", "important");
  if (!(node instanceof HTMLElement)) return;
  node.style.setProperty("width", "100%", "important");
  node.style.setProperty("max-width", "none", "important");
  const masthead = node.querySelector(".masthead");
  if (masthead instanceof HTMLElement) {
    masthead.style.setProperty("width", "100%", "important");
    masthead.style.setProperty("max-width", "none", "important");
    masthead.style.setProperty("align-self", "stretch", "important");
  }
  node.querySelectorAll(".masthead, .masthead > div, [aria-label='Recent'], [data-testid='conversation-sections'], [data-testid='conversation-sections'] section").forEach((child) => {
    if (child instanceof HTMLElement) {
      child.style.setProperty("width", "100%", "important");
      child.style.setProperty("max-width", "none", "important");
    }
  });
}
function stackLibrary(node: HTMLElement | null) {
  node?.style.setProperty("grid-template-columns", "minmax(0, 1fr)", "important");
}
function keepGroupRow(node: HTMLElement | null) {
  if (!node) return;
  node.style.setProperty("align-self", "start", "important");
  node.style.setProperty("align-items", "flex-start", "important");
  node.style.setProperty("height", "auto", "important");
}

function showLatestReply() {
  const scroller = document.querySelector(".thread-shell .flex.min-w-0.flex-1.flex-col > .min-h-0.flex-1");
  if (!(scroller instanceof HTMLElement)) return;
  scroller.style.setProperty("padding-bottom", "12px", "important");
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const title = document.querySelector(".thread-shell h2");
  if (title instanceof HTMLElement && phone) {
    title.style.setProperty("font-size", "1.35rem", "important");
    title.style.setProperty("line-height", "1.25", "important");
  }
  const last = scroller.querySelector("article:last-of-type");
  if (!(last instanceof HTMLElement)) return;
  const top = last.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = Math.max(0, top - 8);
}

function keepCueClear() {
  const shell = document.querySelector(".thread-shell");
  const section = document.querySelector(".thread-shell > section");
  const scroller = document.querySelector(".thread-shell section > .min-h-0.flex-1");
  const cue = document.querySelector("[data-testid='message-cue']");
  const page = shell?.parentElement;
  if (page instanceof HTMLElement) {
    page.style.setProperty("display", "flex", "important");
    page.style.setProperty("flex-direction", "column", "important");
  }
  if (shell instanceof HTMLElement) {
    shell.style.setProperty("flex", "1 1 auto", "important");
    shell.style.setProperty("height", "auto", "important");
    shell.style.setProperty("min-height", "0", "important");
  }
  if (section instanceof HTMLElement) {
    section.style.setProperty("display", "grid", "important");
    section.style.setProperty("grid-template-rows", "auto minmax(0, 1fr) auto", "important");
    section.style.setProperty("min-height", "0", "important");
    section.style.setProperty("overflow", "hidden", "important");
  }
  if (scroller instanceof HTMLElement) {
    scroller.style.setProperty("min-height", "0", "important");
    scroller.style.setProperty("overflow", "auto", "important");
  }
  if (cue instanceof HTMLElement) {
    cue.style.setProperty("position", "relative", "important");
    cue.style.setProperty("z-index", "2", "important");
    cue.style.setProperty("background", "#121214", "important");
    cue.style.setProperty("margin", "0 0.75rem 0.75rem", "important");
  }
}

function keepComposerInside() {
  const home = document.querySelector(".gpt-home");
  if (home instanceof HTMLElement) {
    home.style.setProperty("width", "100%", "important");
    home.style.setProperty("max-width", "100%", "important");
    home.style.setProperty("min-width", "0", "important");
    home.style.setProperty("overflow-x", "hidden", "important");
    home.style.setProperty("box-sizing", "border-box", "important");
    home.style.setProperty("height", "auto", "important");
    const masthead = home.querySelector(".masthead");
    if (masthead instanceof HTMLElement) {
      masthead.style.setProperty("display", "flex", "important");
      masthead.style.setProperty("flex-direction", "column", "important");
      masthead.style.setProperty("align-items", "stretch", "important");
      masthead.style.setProperty("height", "auto", "important");
      masthead.style.setProperty("min-height", "min-content", "important");
      masthead.style.setProperty("flex", "0 0 auto", "important");
      masthead.style.setProperty("overflow", "visible", "important");
      masthead.style.setProperty("width", "100%", "important");
    }
    if (home.parentElement instanceof HTMLElement) {
      home.parentElement.style.setProperty("overflow-x", "hidden", "important");
      home.parentElement.scrollLeft = 0;
    }
  }
  document.querySelectorAll(".gpt-home form, form.thread-composer, section.composer-dock, [data-composer='floating']").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const inThread = node.classList.contains("thread-composer") && document.querySelector(".shell")?.getAttribute("data-view") === "chat";
    const wide = window.innerWidth >= 768;
    node.style.setProperty("position", inThread ? "fixed" : "relative", "important");
    node.style.setProperty("left", inThread ? (wide ? "16.5rem" : "0") : "0", "important");
    node.style.setProperty("right", inThread ? "0" : "auto", "important");
    if (inThread) {
      node.style.setProperty("bottom", "0", "important");
      node.style.setProperty("margin", "0", "important");
      node.style.setProperty("width", "auto", "important");
      node.style.setProperty("z-index", "20", "important");
    }
    node.style.setProperty("transform", "none", "important");
    if (!inThread) node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("min-width", "0", "important");
    node.style.setProperty("margin-left", "0", "important");
    node.style.setProperty("box-sizing", "border-box", "important");
    node.style.setProperty("overflow", "visible", "important");
  });
  document.querySelectorAll(".gpt-home form, form.thread-composer").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("display", "flex", "important");
    node.style.setProperty("flex-direction", "column", "important");
    node.style.setProperty("align-items", "stretch", "important");
    node.style.setProperty("gap", "0.45rem", "important");
  });
  document.querySelectorAll(".shell[data-view='chat'], .shell[data-view='chat'] .main-stage, .thread-shell, .thread-shell > section").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("min-height", "0", "important");
    node.style.setProperty("height", "100%", "important");
  });
  document.querySelectorAll(".thread-shell section > .min-h-0.flex-1").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("flex", "1 1 auto", "important");
    node.style.setProperty("padding-bottom", "7.5rem", "important");
  });
  document.querySelectorAll(".composer-toolbar").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("display", "flex", "important");
    node.style.setProperty("flex-wrap", "wrap", "important");
    node.style.setProperty("align-items", "center", "important");
    node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("min-width", "0", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("max-height", "none", "important");
    node.style.setProperty("align-content", "flex-start", "important");
    node.style.setProperty("overflow", "visible", "important");
    node.style.setProperty("position", "relative", "important");
    node.style.setProperty("left", "0", "important");
    node.style.setProperty("box-sizing", "border-box", "important");
    node.style.setProperty("order", "2", "important");
  });
  document.querySelectorAll("[data-testid='composer-mic-dictate']").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("position", "relative", "important");
    node.style.setProperty("inset", "auto", "important");
    node.style.setProperty("transform", "none", "important");
    node.style.setProperty("margin", "0", "important");
  });
  document.querySelectorAll(".gpt-home textarea, form.thread-composer input, form.thread-composer textarea").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("order", "1", "important");
    node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("min-width", "0", "important");
    node.style.setProperty("flex", "0 1 auto", "important");
    node.style.setProperty("box-sizing", "border-box", "important");
  });
  document.querySelectorAll("[data-testid='composer-effort']").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("min-width", "0", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("max-height", "none", "important");
    node.style.setProperty("flex", "1 1 100%", "important");
    node.style.setProperty("overflow", "visible", "important");
    node.style.setProperty("box-sizing", "border-box", "important");
  });
  document.querySelectorAll("[data-testid='composer-effort'] .flex").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("flex-wrap", "wrap", "important");
    node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("min-width", "0", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("max-height", "none", "important");
    node.style.setProperty("overflow", "visible", "important");
  });
  document.querySelectorAll("[data-testid='composer-effort'] p").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("position", "relative", "important");
    node.style.setProperty("clear", "both", "important");
    node.style.setProperty("width", "100%", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("margin", "0.35rem 0 0", "important");
  });
  document.querySelectorAll(".composer-toolbar > button, .composer-toolbar > label, .composer-toolbar > details").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node instanceof HTMLDetailsElement && node.classList.contains("composer-more") && node.open) return;
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("min-width", "max-content", "important");
    node.style.setProperty("flex", "0 0 auto", "important");
    node.style.setProperty("width", "auto", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("min-height", "2.75rem", "important");
    node.style.setProperty("font-size", "0.85rem", "important");
    node.style.setProperty("overflow", "visible", "important");
    if (window.matchMedia("(max-width: 767px)").matches) node.style.removeProperty("display");
    else node.style.setProperty("display", "inline-flex", "important");
    node.style.setProperty("align-items", "center", "important");
    node.style.setProperty("white-space", "nowrap", "important");
  });
  document.querySelectorAll("[data-testid='composer-mic-dictate'], .composer-send, .gpt-voice").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("display", "inline-flex", "important");
  });
  document.querySelectorAll(".gpt-home .composer-toolbar > button:first-child").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("display", "inline-flex", "important");
    node.style.setProperty("width", "max-content", "important");
    node.style.setProperty("min-width", "max-content", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("padding", "0 0.7rem", "important");
    node.style.setProperty("line-height", "1.2", "important");
    node.style.setProperty("overflow", "visible", "important");
    node.style.setProperty("font-size", "0.85rem", "important");
  });
  document.querySelectorAll("[data-testid='composer-effort'] button, [data-testid='composer-effort'] span").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("width", "auto", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("min-height", "2.25rem", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("overflow", "visible", "important");
    node.style.setProperty("font-size", "0.8rem", "important");
    node.style.setProperty("display", "inline-flex", "important");
    node.style.setProperty("align-items", "center", "important");
    node.style.setProperty("white-space", "nowrap", "important");
    node.style.setProperty("padding", "0 0.65rem", "important");
  });
  const homeForm = document.querySelector(".gpt-home form");
  const scroller = home instanceof HTMLElement ? home.parentElement : null;
  if (homeForm instanceof HTMLElement && scroller instanceof HTMLElement) {
    homeForm.style.setProperty("height", "auto", "important");
    homeForm.style.setProperty("max-height", "none", "important");
    homeForm.style.setProperty("overflow", "visible", "important");
    const formBox = homeForm.getBoundingClientRect();
    const scrollBox = scroller.getBoundingClientRect();
    if (formBox.bottom > scrollBox.bottom - 8) {
      const delta = formBox.bottom - scrollBox.bottom + 12;
      scrollWithoutCoveringGreeting(scroller, delta);
    }
    if (homeForm.getBoundingClientRect().top < scrollBox.top + 8) {
      const delta = homeForm.getBoundingClientRect().top - (scrollBox.top + 8);
      scrollWithoutCoveringGreeting(scroller, delta);
    }
    const dictate = homeForm.querySelector("[data-testid='composer-mic-dictate']");
    if (dictate instanceof HTMLElement) {
      const box = dictate.getBoundingClientRect();
      const limit = scroller.getBoundingClientRect().bottom - 8;
      if (box.bottom > limit) {
        scrollWithoutCoveringGreeting(scroller, box.bottom - limit + 12);
      }
    }
  }
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const handy = document.querySelector("[data-testid='handy-dictation']");
  const dock = document.querySelector(".gpt-home [data-composer='floating']");
  if (phone && handy instanceof HTMLElement && dock instanceof HTMLElement) {
    const handyHeight = Math.ceil(handy.getBoundingClientRect().height);
    if (handyHeight >= 44) {
      document.querySelectorAll(".gpt-home [data-testid='composer-effort']").forEach((node) => {
        if (node instanceof HTMLElement) node.style.setProperty("display", "none", "important");
      });
      const gap = Math.ceil(window.innerHeight - handy.getBoundingClientRect().top) + 8;
      dock.style.setProperty("position", "fixed", "important");
      dock.style.setProperty("left", "0.75rem", "important");
      dock.style.setProperty("right", "0.75rem", "important");
      dock.style.setProperty("width", "auto", "important");
      dock.style.setProperty("max-width", "calc(100vw - 1.5rem)", "important");
      dock.style.setProperty("bottom", `${gap}px`, "important");
      dock.style.setProperty("top", "auto", "important");
      dock.style.setProperty("margin", "0", "important");
      dock.style.setProperty("z-index", "6", "important");
      dock.style.setProperty("overflow", "visible", "important");
      const button = dock.querySelector("[data-testid='composer-mic-dictate']");
      if (button instanceof HTMLElement) button.style.setProperty("z-index", "7", "important");
    }
  }
  liftDictateIntoView();
  keepGuideClear();
  keepBannerClear();
  keepGuideAboveBar();
  keepStartRowInside();
  showVoiceWords();
  document.querySelectorAll(".composer-more__menu").forEach((node) => {
    if (node instanceof HTMLElement) pinComposerMenu(node);
  });
  if (document.querySelector(".shell")?.getAttribute("data-view") === "chat") {
   document.querySelectorAll("form.thread-composer").forEach((node) => {
     if (!(node instanceof HTMLElement)) return;
     const column = node.closest("section");
     const shell = node.closest(".thread-shell");
      const stage = node.closest(".main-stage");
     const topbar = stage?.querySelector(".topbar");
      const search = stage?.querySelector("input[placeholder='Search or jump…']");
      const searchBottom = search instanceof HTMLElement ? search.getBoundingClientRect().bottom : 0;
      const stageTop = stage instanceof HTMLElement ? stage.getBoundingClientRect().top : 0;
      const top = Math.max(topbar instanceof HTMLElement ? Math.ceil(topbar.getBoundingClientRect().height) : 0, Math.ceil(searchBottom - stageTop));
      if (shell instanceof HTMLElement) {
        shell.style.setProperty("position", "fixed", "important");
        shell.style.setProperty("left", "0px", "important");
        shell.style.setProperty("right", "0px", "important");
        shell.style.setProperty("top", `${top}px`, "important");
        shell.style.setProperty("bottom", "0px", "important");
        shell.style.setProperty("width", "100%", "important");
        shell.style.setProperty("max-width", "none", "important");
        shell.style.setProperty("height", "auto", "important");
        shell.style.setProperty("margin", "0", "important");
        shell.style.setProperty("z-index", "5", "important");
      }
      if (column instanceof HTMLElement) {
        column.style.setProperty("position", "absolute", "important");
        column.style.setProperty("inset", "0", "important");
        column.style.setProperty("width", "100%", "important");
        column.style.setProperty("height", "100%", "important");
        column.style.setProperty("min-height", "0", "important");
      }
      node.style.setProperty("position", "absolute", "important");
      node.style.setProperty("left", "0px", "important");
      node.style.setProperty("right", "0px", "important");
      node.style.setProperty("width", "100%", "important");
      node.style.setProperty("max-width", "none", "important");
      node.style.setProperty("bottom", "0px", "important");
      node.style.setProperty("margin", "0", "important");
      node.style.setProperty("padding", "0.55rem 0.75rem 0px", "important");
      node.style.setProperty("border-radius", "0", "important");
      node.style.setProperty("box-sizing", "border-box", "important");
     const formHeight = Math.ceil(node.getBoundingClientRect().height || 120);
      const guesses = document.querySelector(".shell[data-view='chat'] .next-guesses");
      const guessHeight = guesses instanceof HTMLElement ? Math.ceil(guesses.getBoundingClientRect().height) + 8 : 0;
     const thread = column?.querySelector(":scope > .overflow-auto");
     if (thread instanceof HTMLElement) {
       const head = column?.querySelector(":scope > .chat-head");
       const headHeight = head instanceof HTMLElement ? Math.ceil(head.getBoundingClientRect().height) + 8 : 8;
       thread.style.setProperty("position", "absolute", "important");
       thread.style.setProperty("left", "0px", "important");
       thread.style.setProperty("right", "0px", "important");
       thread.style.setProperty("top", `${headHeight}px`, "important");
       thread.style.setProperty("bottom", `${formHeight + guessHeight}px`, "important");
       thread.style.setProperty("width", "100%", "important");
       thread.style.setProperty("max-width", "none", "important");
       thread.style.setProperty("height", "auto", "important");
       thread.style.setProperty("overflow-y", "auto", "important");
       thread.style.setProperty("padding", "0.75rem", "important");
     }
      if (guesses instanceof HTMLElement && column instanceof HTMLElement) {
        guesses.style.setProperty("position", "absolute", "important");
        guesses.style.setProperty("left", "0.75rem", "important");
        guesses.style.setProperty("right", "0.75rem", "important");
        guesses.style.setProperty("width", "auto", "important");
        guesses.style.setProperty("bottom", `${formHeight + 4}px`, "important");
        guesses.style.setProperty("z-index", "6", "important");
        guesses.style.setProperty("display", "flex", "important");
        guesses.style.setProperty("flex-wrap", "wrap", "important");
        guesses.style.setProperty("gap", "0.4rem", "important");
        guesses.style.setProperty("background", "transparent", "important");
       guesses.style.setProperty("pointer-events", "auto", "important");
     }
    });
    document.querySelectorAll("form.thread-composer").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const column = node.closest("section");
      const thread = column?.querySelector(":scope > .overflow-auto");
      const guesses = document.querySelector(".shell[data-view='chat'] .next-guesses");
      if (!(column instanceof HTMLElement) || !(thread instanceof HTMLElement)) return;
      const columnBox = column.getBoundingClientRect();
      const limit = guesses instanceof HTMLElement ? guesses.getBoundingClientRect().top : node.getBoundingClientRect().top;
     const bottom = Math.max(0, Math.ceil(columnBox.bottom - limit) + 8);
      thread.style.setProperty("bottom", `${bottom + 28}px`, "important");
     thread.style.setProperty("overflow", "auto", "important");
    });
    let clear = document.getElementById("chat-no-overlap");
    if (!clear) {
      clear = document.createElement("style");
      clear.id = "chat-no-overlap";
      document.head.appendChild(clear);
    }
    clear.textContent = ".shell[data-view='chat'] .main-stage{transform:none !important}.shell[data-view='chat'] .next-guesses{background:transparent !important;padding:0.35rem 0 !important}.shell[data-view='chat'] .thread-shell article{margin-bottom:0.85rem;background:transparent !important;border:0 !important;box-shadow:none !important;border-radius:0 !important}.shell[data-view='light'] .thread-shell,.shell[data-theme='light'] .thread-shell{color:#111 !important}";
  }
}

function showVoiceWords() {
  document.querySelectorAll(".composer-send, button[aria-label='Speak'], button[aria-label='Mic']").forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.setProperty("display", "inline-flex", "important");
    node.style.setProperty("align-items", "center", "important");
    node.style.setProperty("justify-content", "center", "important");
    node.style.setProperty("gap", "0.35rem", "important");
    node.style.setProperty("width", "auto", "important");
    node.style.setProperty("min-width", "max-content", "important");
    node.style.setProperty("max-width", "100%", "important");
    node.style.setProperty("height", "auto", "important");
    node.style.setProperty("min-height", "2.75rem", "important");
    node.style.setProperty("max-height", "none", "important");
    node.style.setProperty("padding", "0 0.75rem", "important");
    node.style.setProperty("font-size", "0.875rem", "important");
    node.style.setProperty("line-height", "1.2", "important");
    node.style.setProperty("white-space", "nowrap", "important");
    node.style.setProperty("overflow", "visible", "important");
  });
}

function keepStartRowInside() {
  const starters = document.querySelector(".gpt-home .gpt-starters");
  const scroller = starters instanceof HTMLElement ? starters.closest(".overflow-auto") : null;
  if (!(starters instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return;
  starters.style.setProperty("margin-top", "0.5rem", "important");
  starters.style.setProperty("margin-bottom", "0.5rem", "important");
  const scrollBox = scroller.getBoundingClientRect();
  const bar = document.querySelector("[data-testid='handy-dictation']");
  let limit = scrollBox.bottom - 8;
  if (bar instanceof HTMLElement) {
    const barTop = bar.getBoundingClientRect().top;
    if (barTop > scrollBox.top && barTop < scrollBox.bottom) limit = Math.min(limit, barTop - 8);
  }
  const buttons = [...starters.querySelectorAll("button")];
  for (const button of buttons) button.style.removeProperty("margin-top");
  starters.querySelectorAll("p").forEach((node) => {
    if (node instanceof HTMLElement) node.style.removeProperty("margin-top");
  });
  const first = buttons[0];
  let pull = 0;
  if (first) {
    const box = first.getBoundingClientRect();
    if (box.top < limit - 1 && box.bottom > limit + 1) {
      const send = document.querySelector(".gpt-home .composer-send");
      const room = send instanceof HTMLElement ? starters.getBoundingClientRect().top - send.getBoundingClientRect().bottom - 8 : 0;
      pull = Math.min(Math.ceil(box.bottom - limit), Math.floor(Math.max(0, room)));
      if (pull > 1) starters.style.setProperty("margin-top", `${-pull}px`, "important");
    }
  }
  const clipped = buttons.find((button) => {
    const box = button.getBoundingClientRect();
    return box.top - pull < limit - 1 && box.bottom - pull > limit + 1;
  });
  if (clipped && clipped !== first) {
    const push = Math.ceil(limit - (clipped.getBoundingClientRect().top - pull)) + 4;
    if (push > 1) clipped.style.setProperty("margin-top", `${push}px`, "important");
  }
  const cover = bar instanceof HTMLElement ? bar.getBoundingClientRect().top : limit + 8;
  for (const button of buttons) {
    const box = button.getBoundingClientRect();
    if (box.height < 8 || !(box.top < cover - 1 && box.bottom > cover + 1)) continue;
    const current = Number.parseFloat(button.style.marginTop || "0") || 0;
    const push = Math.ceil(cover - box.top) + 8;
    if (push > 1) button.style.setProperty("margin-top", `${current + push}px`, "important");
  }
  const form = document.querySelector(".gpt-home form");
  const floor = form instanceof HTMLElement ? form.getBoundingClientRect().bottom + 8 : scrollBox.top;
  for (const label of starters.querySelectorAll("p")) {
    if (!(label instanceof HTMLElement)) continue;
    const box = label.getBoundingClientRect();
    if (box.height < 8 || !(box.top < cover - 1 && box.bottom > cover + 1)) continue;
    const need = Math.ceil(box.bottom - (cover - 8));
    const room = Math.floor(box.top - floor);
    if (need > 1 && room >= need) {
      const current = Number.parseFloat(starters.style.marginTop || "0") || 0;
      starters.style.setProperty("margin-top", `${current - need}px`, "important");
      continue;
    }
    const current = Number.parseFloat(label.style.marginTop || "0") || 0;
    const push = Math.ceil(cover - box.top) + 8;
    if (push > 1) label.style.setProperty("margin-top", `${current + push}px`, "important");
  }
  for (const button of buttons) {
    const box = button.getBoundingClientRect();
    if (box.height < 8 || !(box.top < cover - 1 && box.bottom > cover + 1)) continue;
    const current = Number.parseFloat(button.style.marginTop || "0") || 0;
    const push = Math.ceil(cover - box.top) + 8;
    if (push > 1) button.style.setProperty("margin-top", `${current + push}px`, "important");
  }
}

function scrollWithoutCoveringGreeting(scroller: HTMLElement, delta: number) {
  if (delta === 0) return;
  if (delta > 0 && scroller.contains(document.querySelector(".gpt-home h1"))) {
    const heading = document.querySelector(".gpt-home h1");
    const banner = document.querySelector(".banner-error");
    if (heading instanceof HTMLElement && banner instanceof HTMLElement) {
      const room = heading.getBoundingClientRect().top - (banner.getBoundingClientRect().bottom + 8);
      if (room <= 1) return;
      delta = Math.min(delta, Math.floor(room));
    }
  }
  scroller.scrollTop += delta;
}

function keepBannerClear() {
  const heading = document.querySelector(".gpt-home h1");
  const banner = document.querySelector(".banner-error");
  if (!(heading instanceof HTMLElement) || !(banner instanceof HTMLElement)) return;
  const scroller = heading.closest(".overflow-auto") ?? heading.closest(".gpt-home")?.parentElement;
  if (!(scroller instanceof HTMLElement)) return;
  const overlap = banner.getBoundingClientRect().bottom + 8 - heading.getBoundingClientRect().top;
  if (overlap <= 1) return;
  scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.ceil(overlap));
}

function keepGuideAboveBar() {
  const guide = document.querySelector("[data-testid='first-steps']");
  if (!(guide instanceof HTMLElement)) return;
  const dock = document.querySelector(".gpt-home [data-composer='floating']");
  const handy = document.querySelector("[data-testid='handy-dictation']");
  const limits: number[] = [];
  if (dock instanceof HTMLElement) limits.push(dock.getBoundingClientRect().top);
  if (handy instanceof HTMLElement) limits.push(handy.getBoundingClientRect().top);
  if (limits.length === 0) return;
  const limit = Math.min(...limits) - 8;
  const applied = Number.parseFloat(guide.style.marginTop || "0") || 0;
  const naturalBottom = guide.getBoundingClientRect().bottom - applied;
  let pull = naturalBottom - limit > 1 ? Math.ceil(naturalBottom - limit) : 0;
  const heading = document.querySelector(".gpt-home h1");
  if (heading instanceof HTMLElement && pull > 0) {
    const naturalTop = guide.getBoundingClientRect().top - applied;
    const room = naturalTop - (heading.getBoundingClientRect().bottom + 8);
    pull = Math.max(0, Math.min(pull, Math.floor(room)));
  }
  const next = pull > 0 ? `-${pull}px` : "";
  if ((guide.style.marginTop || "") === next) return;
  if (next) guide.style.setProperty("margin-top", next, "important");
  else guide.style.removeProperty("margin-top");
}

function keepGuideClear() {
  const guide = document.querySelector("[data-testid='first-steps']");
  const dock = document.querySelector(".gpt-home [data-composer='floating']");
  if (!(guide instanceof HTMLElement) || !(dock instanceof HTMLElement)) return;
  if (!window.matchMedia("(max-width: 767px)").matches) return;
  dock.style.setProperty("position", "relative", "important");
  dock.style.setProperty("inset", "auto", "important");
  dock.style.setProperty("left", "auto", "important");
  dock.style.setProperty("right", "auto", "important");
  dock.style.setProperty("top", "auto", "important");
  dock.style.setProperty("bottom", "auto", "important");
  dock.style.setProperty("width", "100%", "important");
  dock.style.setProperty("max-width", "100%", "important");
  dock.style.setProperty("z-index", "1", "important");
  dock.style.setProperty("transform", "none", "important");
  dock.style.setProperty("margin", "0", "important");
  const handy = document.querySelector("[data-testid='handy-dictation']");
  const scroller = [...document.querySelectorAll(".overflow-auto")].find((node) => node instanceof HTMLElement && node.contains(guide) && node.scrollHeight > node.clientHeight + 8);
  if (!(scroller instanceof HTMLElement)) return;
  const limit = handy instanceof HTMLElement ? handy.getBoundingClientRect().top - 8 : window.innerHeight - 8;
  const covered = dock.getBoundingClientRect().bottom - limit;
  if (covered > 1) scrollWithoutCoveringGreeting(scroller, Math.ceil(covered));
  const hidden = 8 - guide.getBoundingClientRect().top;
  if (hidden > 1) scroller.scrollTop -= Math.ceil(hidden);
}

function liftDictateIntoView() {
  const button = document.querySelector(".gpt-home [data-testid='composer-mic-dictate']");
  const handy = document.querySelector("[data-testid='handy-dictation']");
  if (!(button instanceof HTMLElement) || !(handy instanceof HTMLElement)) return;
  const limit = handy.getBoundingClientRect().top - 8;
  let box = button.getBoundingClientRect();
  if (box.bottom <= limit) return;
  let node = button.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
    if (scrolls && node.scrollHeight > node.clientHeight + 1) {
      scrollWithoutCoveringGreeting(node, box.bottom - limit + 4);
      box = button.getBoundingClientRect();
      if (box.bottom <= limit) return;
    }
    node = node.parentElement;
  }
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
  { id: "intelligence", label: "EVE", icon: Bot },
  { id: "agents", label: "Bots", icon: Bot },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "skills", label: "Skills", icon: Zap },
  { id: "voice", label: "Voice clone", icon: Volume2 },
  { id: "runs", label: "Runs", icon: Activity },
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
  runs: "/brand/marks/activity.png",
  memory: "/brand/marks/memory.png",
  activity: "/brand/marks/activity.png",
  help: "/brand/marks/help.png",
};

function navMark(id: string): string {
  return NAV_MARKS[id] ?? "/brand/logo-mark.jpg";
}

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
  const { ws, setWs, ready, syncNote, serverHeld, saveError, retrySave, clearStoredCopy } = useMindWorkspace(account?.id ?? (loopback ? "dev-user" : null), account?.primaryEmail ?? null);
  const router = useRouter();
  const [view, setViewState] = useState<View>("command");
  const applyingLocation = useRef(false);
  const locationHistory = useRef<"push" | "replace">("push");
  function setView(next: View) {
    setViewState(next);
  }
  const [imagineEdit, setImagineEdit] = useState<{ image: string; text: string; returnFocus: HTMLElement | null } | null>(null);
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
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [cardFocus, view]);
  const [homeAction, setHomeAction] = useState<"ask" | "image" | "video" | "write" | "search">("ask");
  const [settingsPane, setSettingsPane] = useState<null | "general" | "connections" | "voice" | "pages" | "data" | "safety" | "keys">(null);
  const [wipeAsk, setWipeAsk] = useState(false);
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
    const drawer = navDrawerRef.current;
    const phone = window.matchMedia("(max-width: 767px)").matches;
    if (drawer && phone) {
      const light = document.documentElement.dataset.theme === "light";
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  const [surfaceAnchor, setSurfaceAnchor] = useState<DOMRect | null>(null);
  const [controlsAnchor, setControlsAnchor] = useState<DOMRect | null>(null);
  const [navMoreOpen, setNavMoreOpen] = useState(false);
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
  const closeVoiceOverlayRef = useRef<() => void>(() => undefined);
  const cancelDictationRef = useRef<(announce?: boolean) => void>(() => undefined);
  const turnGen = useRef(0);
  const turnInFlight = useRef(false);
  const deliverStoredUser = useRef(false);
  const cueRef = useRef<CuedMessage[]>([]);
  const [cued, setCued] = useState<CuedMessage[]>([]);
  const imagineInFlight = useRef(false);
  const videoInFlight = useRef(false);
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
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
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
  const [consultModel, setConsultModel] = useState("");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("A");
  const [routingPanel, setRoutingPanel] = useState<LogicRouteId[]>([]);
  const [ratings, setRatings] = useState<ResponseRating[]>([]);
  const [lastResolvedTier, setLastResolvedTier] = useState<ConcreteModelTier | null>(null);
  const [lastModelUsed, setLastModelUsed] = useState<string | null>(null);
  const [failoverPolicy, setFailoverPolicy] = useState<"none" | "grok">("none");
 const [researchCitations, setResearchCitations] = useState<{ title: string; url: string }[]>([]);
  const [researchReportQuestion, setResearchReportQuestion] = useState("");
  const [researchHistory, setResearchHistory] = useState<{ id: string; question: string; summary: string; citations: { title: string; url: string }[]; at: string }[]>([]);
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
  const [memoryProject, setMemoryProject] = useState("");
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memoryTab, setMemoryTab] = useState<"mine" | "project" | "transfer">("mine");
  const memoryScope = memoryTab === "project" ? "project" : "global";
  const [researchText, setResearchText] = useState("");
  const [researchBand, setResearchBand] = useState<"search" | "saved" | "files">("search");
  const [researchNote, setResearchNote] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [chatProjectId, setChatProjectId] = useState<string | null>(null);
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
  const [staged, setStaged] = useState<Staged | null>(null);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
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
    ...builtinModules({ grokConfigured, providers: liveProviders }),
    ...customModules(customAiProviders.map((item) => ({ id: item.id, label: item.label, models: item.models, hasKey: item.hasKey }))),
  ], [grokConfigured, liveProviders, customAiProviders]);

  useEffect(() => {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const next = loadConsultModel(storage, consultModules);
    setConsultModel((current) => (consultModules.some((item) => item.connected && item.id === current) ? current : next));
  }, [consultModules]);

  function chooseConsultModel(id: string) {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    saveConsultModel(storage, id);
    setConsultModel(id);
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
  const [skillRefresh, setSkillRefresh] = useState<ReturnType<typeof refreshSkills> | null>(null);
  const [skillBand, setSkillBand] = useState<"device" | "installed" | "missing">("device");
  const [enabledSkills, setEnabledSkills] = useState<Record<string, boolean>>({});
  const [skillNoteQuery, setSkillNoteQuery] = useState("");
  const [skillResult, setSkillResult] = useState<{ id: string; text: string } | null>(null);
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

  useEffect(() => {
    if (view !== "skills") return;
    setSkillRefresh(refreshSkills());
  }, [view]);

  useEffect(() => {
    if (view !== "chat") return;
    showLatestReply();
    keepCueClear();
    keepComposerInside();
  }, [view, active?.id, active?.messages.length, busy, cued.length]);

  useEffect(() => {
    keepComposerInside();
    const fit = () => keepComposerInside();
    const observer = new ResizeObserver(fit);
    document.querySelectorAll(".gpt-home [data-composer='floating'], [data-testid='handy-dictation'], [data-testid='first-steps'], .gpt-home, .banner-error").forEach((node) => observer.observe(node));
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-testid='first-steps']")) return;
      fit();
    };
    window.addEventListener("resize", fit);
    document.addEventListener("focusin", onFocus);
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(fit));
    let retries = 0;
    const retry = window.setInterval(() => {
      keepBannerClear();
      keepGuideAboveBar();
      retries += 1;
      const heading = document.querySelector(".gpt-home h1");
      const banner = document.querySelector(".banner-error");
      const clear = banner instanceof HTMLElement && heading instanceof HTMLElement && heading.getBoundingClientRect().top >= banner.getBoundingClientRect().bottom + 8;
      if (clear || retries > 24) window.clearInterval(retry);
    }, 50);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(retry);
      observer.disconnect();
      window.removeEventListener("resize", fit);
      document.removeEventListener("focusin", onFocus);
    };
  }, [view, guide.dismissed, guide.step, ws.halted]);

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
    if (logicRoutes.length === 0) return;
    const stored = logicRoutes.find((item) => item.id === logicRoute || item.id === providerChoice);
    if (!stored || (stored.ready && !stored.credentialFallback)) return;
    setLogicRoute(null);
    if (isLogicRouteId(providerChoice)) setProviderChoice("grok");
  }, [logicRoutes, logicRoute, providerChoice]);

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
    try {
      const stored = JSON.parse(localStorage.getItem("amcos.research.v1") || "[]") as { id: string; question: string; summary: string; citations: { title: string; url: string }[]; at: string }[];
      if (Array.isArray(stored)) setResearchHistory(stored.slice(0, 8));
    } catch {
      /* a private browser can refuse storage */
    }
  }, []);

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
    applyMotionChoice(document, motionChoice);
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
    window.location.assign("/login");
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
    if (hit.view === "chat" && hit.ref) setActiveId(hit.ref);
    if (hit.view === "projects" && hit.ref) setShareProjectId(hit.ref);
    if (hit.view === "agents" && hit.ref) setShareBotId(hit.ref);
    if (hit.view === "files" && hit.ref) {
      setLibraryProjectId(null);
      setOpenFileId(hit.ref);
      setLibraryBand("preview");
    }
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
      void navigator.clipboard?.writeText(text).then(
        () => setNotice(targets.length === 1 ? "Link copied. It opens this conversation on a device that already has it." : "Links copied."),
        () => setNotice("Clipboard copy was blocked."),
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
      const name = targets.length === 1 ? shownChatTitle(targets[0]!) : extra?.title || targets[0]!.title;
      const result = scheduleConversation(wsRef.current, name);
      if (result.error) {
        setError(result.error);
        return;
      }
      setWs(pushAudit(result.ws, "schedule_chat", targets[0]!.id, result.created ? "saved off" : "already scheduled"));
      setView("scheduled");
      setNavOpen(false);
      setNotice(result.created ? "The schedule is saved and off. Nothing runs until you turn it on." : "That schedule is already saved. Nothing new was added.");
      return;
    }
    if (action === "pin") {
      const allPinned = targets.every((chat) => wsRef.current.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id));
      setWs((prev) => targets.reduce((next, chat) => {
        const isPinned = next.pins.some((pin) => pin.kind === "chat" && pin.ref === chat.id);
        return allPinned || !isPinned ? togglePin(next, "chat", chat.id) : next;
      }, prev));
      setNotice(allPinned ? "Unpinned." : "Pinned.");
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
      setNotice(extra?.projectId ? "Added to the project." : "Removed from the project.");
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
          const usable = matches.filter((skill) => skill.kind !== "not-installed");
          const one = usable.length === 1 ? usable[0] : null;
          const reply = one
            ? runSkill(source, one, enabledSkills[one.id] !== false).text
            : matches.map((skill) => `${skill.name} — ${skill.kind === "not-installed" ? "Not installed" : skill.kind === "installed" ? "Installed" : "Built-in"}. ${skill.needs}`).join("\n") || "No skill matches. Nothing was run.";
          return { ok: true, text: reply };
        },
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
            const saved = JSON.parse(xhr.responseText) as { ok?: boolean; note?: string; error?: string };
            return { ok: saved.ok !== false, text: saved.note || saved.error || "The skill was not saved." };
          } catch {
            return { ok: false, text: "The skill was not saved. Nothing was sent off this machine." };
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
    setBusy(true);
    setError(null);
    try {
      const result = await searchWeb({ data: { query } });
      setBusy(false);
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
    options?: { logicRoute?: LogicRouteId | null; skipUserMessage?: boolean; isolateOutputs?: boolean; accessNotes?: { id: string; text: string }[] },
  ): Promise<string | null> {
    if (turnInFlight.current) return null;
    const snapped = snapshotImages(images);
    if (shouldBlockForEmergencyStop(wsRef.current.halted, source.halted)) {
      reportEmergencyStop(chat.id, () => {
        void deliver(chat, text, wsRef.current, resume, snapped);
      });
      return null;
    }
    const botRoute = routeForBotChat(chat, { provider: providerChoice, modelTier });
    const selectedProvider = botRoute.provider;
    const selectedTier = botRoute.modelTier;
    const activeLogic = options && "logicRoute" in options
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
    const otherReady = !activeLogic && !isCustomProvider && selectedProvider !== "grok" && liveProviders[selectedProvider as "openai" | "anthropic" | "gemini" | "openrouter"] === true;
    let routed = chosenProvider(activeLogic || isCustomProvider ? "grok" : selectedProvider, isCustomProvider ? true : grokConfigured);
    if (!otherReady && !activeLogic && !isCustomProvider && !routed.ok) {
      const switched = failover(selectedProvider, grokConfigured === true, failoverPolicy);
      if (switched.provider === "grok") {
        routed = chosenProvider("grok", grokConfigured);
        if (routed.ok) setNotice(switched.note);
      }
    }
    const orchestrating = resolveSendPath(composerEffort).path === "orchestrator";
    const consultPlan = orchestrating
      ? planModelConsult({ orchestrator: consultModel, modules: consultModules, question: text })
      : null;
    if (consultPlan && !consultPlan.ok) {
      reportFailure(consultPlan.error, "model_unavailable", "provider", () => {
        void deliver(chat, text, wsRef.current, resume, snapped);
      });
      return null;
    }
    if (!orchestrating && !otherReady && !activeLogic && !isCustomProvider && !routed.ok) {
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
      deliverStoredUser.current = true;
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
          memory: options?.accessNotes?.length ? "on" : chat.memory,
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
            ...memoriesForChat(source, chat).map((item) => ({ id: item.id, text: item.text })),
          ].slice(0, 12),
          botKnowledge: chat.botKnowledge ?? "",
          provider: consultPlan && consultPlan.ok
            ? consultPlan.plan.orchestrator
            : activeLogic ?? (isCustomProvider || otherReady ? selectedProvider : (routed.ok ? routed.id : selectedProvider)),
          modelTier: selectedTier,
          logicRoute: consultPlan && consultPlan.ok ? null : activeLogic,
          orchestrator: consultPlan && consultPlan.ok ? consultPlan.plan.orchestrator : null,
          composerMode: orchestrating ? "orchestrator" : undefined,
          identity: ADRIAN_MIND_IDENTITY,
          consult: consultPlan && consultPlan.ok ? {
            available: consultPlan.plan.available,
            helpers: consultPlan.plan.helpers,
            purpose: consultPlan.plan.purpose,
          } : null,
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

  async function deliverPlanned(chat: Chat, full: string, source: Workspace, images: ImageAttachment[]): Promise<boolean> {
    deliverStoredUser.current = false;
    const primary = logicRoute ?? (isLogicRouteId(providerChoice) ? providerChoice : null);
    const seats = logicRoutes.map((item) => ({ id: item.id, label: item.label, ready: item.ready, reason: item.reason }));
    const plan = planRouting({ mode: routingMode, primary, seats, panel: routingPanel });
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
    activeIdRef.current = made.chat.id;
    if (!wsRef.current.chats.some((item) => item.id === made.chat.id)) {
      wsRef.current = { ...wsRef.current, chats: [made.chat, ...wsRef.current.chats] };
    }
    setView("chat");
    setWs((prev) => {
      let next = { ...prev, chats: [made.chat, ...prev.chats] };
      if (file) next = addLocalFile(next, { name: file.name, text: file.text, projectId: projectChoice || null });
      return pushAudit(next, "create_chat", made.chat.id, `memory ${made.chat.memory}; ${made.chat.autonomy}`);
    });
    const effortPath = resolveSendPath(composerEffort);
    if (effortPath.notice) setNotice(effortPath.notice);
    const finished = await deliverPlanned(made.chat, full, { ...ws, chats: [made.chat, ...ws.chats] }, images);
    if (finished) await releaseNextCue();
  }

  async function startResearch(question = researchText) {
    const query = question.trim();
    if (!query || researchFlight.current) return;
    if (wsRef.current.halted) {
      reportEmergencyStop("search", () => {
        void startResearch(query);
      });
      return;
    }
    researchFlight.current = true;
    setResearchPending(true);
    try {
      const result = await searchWeb({ data: { query } });
      setError(null);
      setWs((prev) => pushAudit(prev, result.configured && result.ok ? "research_result" : "research_refused", "search", result.ok ? `${result.citations.length} sources` : "no citation"));
      if (!result.ok) {
        reportFailure(result.error || "Research refused. No citations were created.", "research_failed", "search", () => {
          void startResearch(query);
        });
      } else {
        setResearchReportQuestion(query);
        setResearchCitations(result.citations);
        setResearchNote(result.summary || "");
        const report = { id: crypto.randomUUID(), question: query, summary: result.summary || "", citations: result.citations, at: new Date().toISOString() };
        setResearchHistory((current) => {
          const next = [report, ...current].slice(0, 8);
          try { localStorage.setItem("amcos.research.v1", JSON.stringify(next)); } catch { /* private mode */ }
          return next;
        });
        clearFailure();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The search did not run. No citations were created.";
      reportFailure(message, "research_failed", "search", () => {
        void startResearch(query);
      });
    } finally {
      researchFlight.current = false;
      setResearchPending(false);
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

  function rememberCue(next: CuedMessage[]) {
    cueRef.current = next;
    setCued(next);
  }

  async function releaseNextCue() {
    if (wsRef.current.halted || turnInFlight.current) return;
    const wanted = activeIdRef.current;
    const chat = wanted
      ? wsRef.current.chats.find((item) => item.id === wanted) ?? null
      : wsRef.current.chats[0] ?? null;
    if (!chat) return;
    const held = takeNextCue(cueRef.current);
    if (!held.next) return;
    rememberCue(held.queue);
    setView("chat");
    const finished = await deliverPlanned(chat, held.next.text, wsRef.current, []);
    if (!finished && !deliverStoredUser.current) {
      rememberCue(restoreCue(cueRef.current, held.next));
      setNotice("The next line stayed in the cue. Nothing was sent.");
      return;
    }
    if (finished) await releaseNextCue();
  }

  async function sendInChat(queuedText?: string) {
    const sendingQueued = typeof queuedText === "string";
    if ((busy || turnInFlight.current) && !sendingQueued) {
      if (!draft.trim()) return;
      const result = cueMessage(cueRef.current, draft, crypto.randomUUID());
      if (result.error) {
        setError(result.error);
        return;
      }
      rememberCue(result.queue);
      setDraft("");
      setError(null);
      setNotice("Cued. It sends after this reply.");
      return;
    }
    if (!active) {
      void sendCommand();
      return;
    }
    const text = (sendingQueued ? queuedText : draft).trim();
    const images = sendingQueued ? [] : snapshotImages(pendingImages);
    const file = sendingQueued ? null : staged;
    const gate = canSend({ halted: wsRef.current.halted, busy: sendingQueued ? false : busy });
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
    if (!sendingQueued) {
      setDraft("");
      setStaged(null);
      setPendingImages([]);
    }
    const source = ws;
    const action = voiceNext.current ? "voice" as const : "chat" as const;
    voiceNext.current = false;
    if (settleIntent(active, full, source, action)) {
      if (file) setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: active.projectId }));
      await releaseNextCue();
      return;
    }
    if (file) {
      setWs((prev) => addLocalFile(prev, { name: file.name, text: file.text, projectId: active.projectId }));
    }
    const effortPath = resolveSendPath(composerEffort);
    if (effortPath.notice) setNotice(effortPath.notice);
    const finished = await deliverPlanned(active, full, ws, images);
    if (finished) await releaseNextCue();
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

  async function runVideo(promptRaw?: string) {
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
        body: JSON.stringify({ kind: "video", action: "start", prompt, duration: 5 }),
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
        setImagineEditError(failure.message);
        setWs((previous) => pushAudit(previous, failure.kind, failure.target, failure.message));
        return;
      }
      const images: ImageAttachment[] = payload.images.map((image, index) => ({
        dataUrl: image.dataUrl,
        name: image.name || `imagine-edit-${index + 1}.jpg`,
        mime: image.mime,
      }));
      if (!active) setPendingImages((previous) => [...previous, ...images].slice(0, 4));
      closeImagineEditor();
      setNotice(`Edited with ${payload.model || "grok-imagine-image"}. ${active ? "Added to this chat." : "Staged for Send / Agent."}`);
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
        return [...prev, { dataUrl: item.dataUrl, name: item.name, mime: item.mime }];
      });
      setError(null);
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
    const stagedFile = { name: file.name, text: text.slice(0, 40000) };
    const partial = pdf?.partial || text.length > stagedFile.text.length;
    if (view === "files") {
      if (wsRef.current.files.length >= 40) {
        setError("Library holds 40 text copies. Remove an existing copy before uploading another.");
        return;
      }
      const savedId = crypto.randomUUID();
      setWs((prev) => {
        return addLocalFile(prev, { id: savedId, name: stagedFile.name, text, partial, projectId: libraryProjectId || projectChoice || null });
      });
      setOpenFileId(savedId);
      setLibraryBand("preview");
      const savedCopy = partial ? `a partial text copy of “${file.name}”` : pdf ? `extracted text from “${file.name}”` : `“${file.name}”`;
      setNotice(`Saved ${savedCopy} to Library.`);
      return;
    }
    setStaged(stagedFile);
    setError(null);
    if (inspectNext.current) {
      const destination = inspectNext.current;
      inspectNext.current = null;
      await inspectWithRea(stagedFile, destination);
      return;
    }
    setNotice(`“${file.name}” is staged${partial ? " as a partial text copy" : pdf ? " as extracted text" : ""}. Press Send to include it, or Analyze File to run REA.`);
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
  async function pressEmergencyStop() {
    interruptSpeakPlayback();
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
    clearedStop.current = true;
    setError(null);
    setWs((prev) => (prev.halted ? pushAudit({ ...prev, halted: false }, "emergency_stop", "session", "cleared by eve") : prev));
    setNotice("EVE cleared the emergency stop from Speak. Schedules stay paused until you enable them.");
    try {
      const result = await setExecutionHalt({ data: { on: false } });
      if (!result.ok) setError(result.error);
    } catch {
      setError("The server did not confirm the clear. The stop is off in this browser.");
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
    sessionStorage.setItem("adrian-build-draft", task.slice(0, 4000));
    sessionStorage.setItem("adrian-human-return", id);
    if (command === "/fix" || command === "/run" || command === "/test") sessionStorage.setItem("adrian-build-mode", "auto");
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
    const reply = await deliver({ ...chat, personalityId: spokenStyle, memory: "on" }, transcript, source, false, [], { accessNotes: eveAccessNotes(source) });
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
        transcribe: async (audioBase64) => {
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
          const volume = Number(localStorage.getItem("adrian-speak-volume"));
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
    if (parseCreateBot(text)) {
      const made = createBotFromSpeech(wsRef.current, text);
      if (!made.ok) {
        setNotice(made.error);
        if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: text, error: made.error }));
        return;
      }
      setWs(made.ws);
      setNotice(made.reply);
      if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: text, reply: made.reply, error: "" }));
      speakOnOpenSession(made.reply);
      return;
    }
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
      window.speechSynthesis?.cancel();
      voiceSession.current?.interruptPlayback();
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
      if (!voiceSession.current?.isOpen) speakOnOpenSession(conducted.text);
      return;
      }
    }
    const liveVoice = replyVoiceForTurn({
      liveSessionOpen: Boolean(voiceSession.current?.isOpen),
      mode: "direct",
      placingCall: false,
    });
    if (!shouldSpeakTranscriptAgain(liveVoice)) {
      appendLiveVoiceUser(text);
      setNotice("Heard you. This turn uses one voice.");
      if (overlayOpenRef.current) setOverlayNotice("Heard you. This turn uses one voice.");
      return;
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
    window.dispatchEvent(new CustomEvent("adrian:handy-mic"));
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
      commitDictation({
        type: "stop_error",
        message: "This browser could not record. Nothing was transcribed.",
      });
      setNotice("This browser could not record. Nothing was transcribed. Nothing was sent.");
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
        personalityId: speakStylePersonality(typeof localStorage === "undefined" ? null : localStorage.getItem("adrian-speak-style")),
        customPersonality: voiceChat?.customPersonality ?? "",
        characterId: readStoredCharacterId(typeof localStorage === "undefined" ? null : localStorage),
      });
      const session = new RealtimeVoiceSession(
        {
          onTranscript: (text) => {
            setVoiceLiveTranscript(clampLiveTranscript(text));
            if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, heard: text, error: "" }));
            void handleVoiceTranscript(text);
          },
          onAssistantTranscript: (text) => {
            appendLiveVoiceAssistant(text);
            if (speakStageOpenRef.current) setSpeakCall((current) => ({ ...current, reply: text, error: "" }));
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
            setVoiceListening(status === "listening" || status === "processing" || status === "connecting");
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
    <div className="shell flex h-dvh flex-col bg-bg text-fg md:flex-row" data-view={view} data-search={paletteOpen ? "open" : "closed"}>
      <MenuMotion />
      {navOpen ? <button type="button" className="fixed inset-0 md:hidden" aria-label="Close menu" style={{ zIndex: 150, background: "transparent" }} onClick={() => setNavOpen(false)} /> : null}
      <aside ref={(node) => { navDrawerRef.current = node; pinRailFrame(node); }} onMouseDown={closeNavFromBackdrop} role={navOpen ? "dialog" : undefined} aria-modal={navOpen ? false : undefined} aria-label={navOpen ? "Workspace navigation" : undefined} className={`rail gpt-rail ${navOpen ? "nav-drawer-open flex" : "hidden"} fixed inset-0 z-40 w-full flex-col overflow-hidden md:static md:flex md:h-dvh ${railCollapsed ? "md:w-[4.5rem]" : "md:w-72"} md:shrink-0`}>
        <div className="gpt-rail-head flex items-center gap-3 px-4 py-4">
          {!railCollapsed && (
            <p className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-semibold tracking-tight">
              <img className="service-mark adrian-mark" src="/brand/logo-mark.jpg" alt="" width={32} height={32} />
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
        <nav ref={pinRailScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="workspace-nav" style={{ overflowY: "auto", minHeight: 0 }}>
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
            className={`nav-item flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium text-muted ${railCollapsed ? "justify-center" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <img className="service-mark size-5 rounded-md object-cover" src="/apps/social/assets/mark.jpg" alt="" width={22} height={22} />
            {!railCollapsed && "Social"}
          </Link>
          <Link
            to="/gpt-wrapper"
            data-testid="nav-route-gpt-wrapper"
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
            {navMoreOpen ? (
              <AnchoredCard anchor={navMoreAnchor} label="More" onClose={() => setNavMoreOpen(false)} testId="nav-more-panel" width={640} align="start">
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
                          <img className="service-mark size-5 shrink-0 rounded-md object-cover" src={navMark(item.id)} alt="" width={22} height={22} />
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
          <Link to="/dashboard" data-testid="nav-route-dashboard" className="nav-route-link sr-only">Dashboard</Link>
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
                scheduledNames={ws.schedules.map((job) => job.name)}
                onOpen={(id) => {
                  setActiveId(id);
                  setView(isIntelligenceThread(ws.chats.find((chat) => chat.id === id)?.customPersonality) ? "code" : "chat");
                  setNavOpen(false);
                }}
                onAction={runConversationAction}
                extras={(ids) => (ids.length === 1 && ids[0] === activeId ? [{ label: "Download transcript", onPick: exportActive }] : [])}
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
        <header className="topbar flex flex-nowrap items-center gap-2 px-3 py-3 md:gap-3 md:px-5" ref={(node) => node?.style.setProperty("overflow", "visible", "important")}>
         <button type="button" className="grid size-11 shrink-0 place-items-center rounded-panel border border-line md:hidden" aria-label="Open menu" onClick={openNav}>
           <Menu className="size-4" />
         </button>
          <div className="surface-switch relative shrink-0">
            <button
              type="button"
              className="surface-switch__button shrink-0 whitespace-nowrap"
              aria-expanded={surfaceMenu}
              aria-haspopup="menu"
              aria-label={`Current surface: ${TITLES[view] ?? "Chat"}. Switch between Chat, Build, Intelligence, and EVE`}
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
                      ["intelligence", "EVE", "Intelligence layer"],
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
                  const kind = hit.meta === "Chat" ? "chat" : hit.meta === "Agent" ? "agent" : hit.meta === "Project" ? "project" : hit.meta === "File" ? "file" : null;
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
                          event.currentTarget.dataset.held = "0";
                          const timer = window.setTimeout(() => {
                            event.currentTarget.dataset.held = "1";
                            setWs((prev) => togglePin(prev, kind, hit.ref));
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
                        <span className="truncate">{hit.label}</span>
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
              aria-expanded={controlsOpen}
              aria-haspopup="menu"
              aria-label="Open controls"
              onClick={(event) => {
                const next = !controlsOpen;
                closeMenus("controls");
                setControlsAnchor(event.currentTarget.getBoundingClientRect());
                setControlsOpen(next);
              }}
            >
              <span>Controls</span>
              <span aria-hidden="true">▾</span>
            </button>
            {view === "chat" ? (
              <button
                type="button"
                className="surface-switch__button shrink-0 whitespace-nowrap"
                data-testid="open-chat-settings"
                aria-label="Chat settings"
                onClick={() => {
                  const node = document.querySelector(".thread-chat-settings");
                  if (node instanceof HTMLDetailsElement) node.open = !node.open;
                }}
              >
                <span>Chat settings</span>
              </button>
            ) : null}
            {controlsOpen ? (
              <AnchoredCard anchor={controlsAnchor} label="Controls" onClose={() => setControlsOpen(false)} testId="controls-menu" width={640} align="start">
                <MenuShelf width="100%" testId="controls-shelf">
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
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-11 flex-col items-start justify-center rounded-2xl px-3 text-left"
                    style={menuChip}
                    title={headerDetail}
                    aria-label={`${headerState}. ${headerDetail}`}
                    onClick={() => { setView("connected"); setControlsOpen(false); setNavOpen(false); }}
                  >
                    <span className="inline-flex items-center gap-2 text-sm"><img src="/brand/logos/grok.svg" alt="" width={16} height={16} className="size-4 rounded" />{headerState}</span>
                    <span className="text-xs text-muted">Connected services</span>
                  </button>
                </MenuCluster>
                <MenuCluster label="Model" wide>
                  <button
                    type="button"
                    className="flex min-h-11 items-center justify-between rounded-2xl px-3 text-left text-sm"
                    style={menuChip}
                    aria-expanded={modelRowsOpen}
                    onClick={() => setModelRowsOpen((value) => !value)}
                  >
                    <span>{modelTier}</span>
                    <span aria-hidden="true">{modelRowsOpen ? "‹" : "›"}</span>
                  </button>
                  {modelRowsOpen ? (
                    <ModelTierChip
                      presentation="rows"
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
                  ) : null}
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
                      {consultModules.filter((item) => item.connected).length === 0 ? <span className="px-3 py-2 text-xs text-muted">No model is connected right now.</span> : null}
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
                          <span>{item.label}</span>
                          <span className="text-xs text-muted">Consult</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </MenuCluster>
                <MenuCluster label="Install" wide>
                  <a role="menuitem" className="flex min-h-11 items-center rounded-2xl px-3 text-sm" style={menuChip} href="/downloads/AdriansMind-Setup.exe" download data-testid="header-download-installer">Download Adrian's Mind</a>
                  <p className="px-3 pb-2 text-xs text-muted" data-testid="installer-note">Unsigned Windows app. It contains this product, including Build. It does not control the mouse, keyboard, or browser.</p>
                  <DesktopUpdateNote />
                </MenuCluster>
                </MenuShelf>
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
            <Volume2 className="size-4" /> Speak
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
              {ws.halted ? <p className="px-3 py-2 text-sm text-danger">Emergency stop is on. Sending and approvals are blocked.</p> : <p className="px-3 py-2 text-sm text-muted">No active alerts.</p>}
            </MenuGroup>
            <MenuGroup label="Recent">
              {ws.audit.length === 0 ? <p className="px-3 py-2 text-sm text-muted">Nothing recorded yet.</p> : null}
              {ws.audit.slice(0, 4).map((entry) => (
                <p key={entry.id} className="px-3 py-2 text-sm text-muted">
                  {humanAction(entry.action)} · {stamp(entry.at)}
                </p>
              ))}
              {ws.audit.length > 0 ? <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { setView("activity"); closeMenus(); }}>View activity</button> : null}
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
                <Link to="/login" className="flex min-h-11 items-center rounded-2xl px-3 text-sm" style={menuChip}>
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
        {statusSignedIn !== true && typeof window !== "undefined" && window.location.hostname !== "127.0.0.1" && window.location.hostname !== "localhost" && (
          <div className="signed-out-entry sign-in-strip" data-testid="signed-out-entry" role="status">
            <span>Sign in to use voice and connected services.</span>
            <Link to="/login" className="signed-out-entry__link">Sign in</Link>
          </div>
        )}

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
              onAsk={async (text) => {
                const blocked = decideComputerAction({ text, halted: wsRef.current.halted === true, paired: false, actor: "eve" });
                if (blocked.kind !== "none") return blocked.message;
                const turn = await speakChatTurn(text, { stay: true });
                if (!turn.ok) return turn.error;
                const spoken = await speak(turn.text);
                if (!spoken?.ok) return spoken?.error || "The reply was written, but it was not spoken.";
                return turn.text;
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
                <DashboardApp embedded />
              </Suspense>
            </div>
          )}
          {view === "command" && (
           <div ref={liftHomeStack} className="gpt-home mx-auto flex min-h-full w-full max-w-none flex-col justify-start gap-4 p-4 md:p-6" style={{ justifyContent: "flex-start" }}>
              <div className="masthead flex w-full items-center gap-3">
                <div className="flex w-full flex-wrap items-end justify-between gap-3">
                  <div className="w-full min-w-0">
                    <h1 className="font-display text-3xl font-bold md:text-4xl">
                      {now ? greeting(now) : "Hello"}, <span className="text-accent">Adrian</span>
                    </h1>
                    <p className="text-sm text-muted">Ask, build, or connect. The rest lives in Settings.</p>
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
                          scheduledNames={ws.schedules.map((job) => job.name)}
                         onOpen={(id) => { setActiveId(id); setView("chat"); }}
                         onAction={runConversationAction}
                         extras={(ids) => (ids.length === 1 && ids[0] === activeId ? [{ label: "Download transcript", onPick: exportActive }] : [])}
                       />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              {homeAction !== "ask" && <button type="button" className="min-h-11 px-3 text-sm text-muted" onClick={() => { setHomeAction("ask"); setCommandMode("ask"); }}>Clear mode · Back to Chat</button>}

              <FirstSteps state={guide} onChange={persistGuide} onOpen={openGuide} />
              <section ref={liftHomeComposer} className="floating-composer command-card composer-dock rounded-panel p-3 md:p-4" data-composer="floating">
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
                      {error.includes("Sign in") ? <Link to="/login">Sign in</Link> : null}
                    </p>
                  ) : null}
                  {notice ? (
                    <p className="composer-notice attachment-feedback mt-2 text-sm text-muted" role="status" data-testid="composer-notice">{presentVoiceCopy(notice)}</p>
                  ) : null}
                  {staged && (
                    <div className="attachment-feedback flex flex-wrap items-center gap-2 text-xs text-muted"><span>Attached: {staged.name}</span><button type="button" className="min-h-11 text-accent" onClick={() => { setStaged(null); setNotice(null); }}>Remove attachment</button></div>
                  )}
                  <div className="composer-toolbar mt-2 flex flex-wrap items-center gap-2">
                    <details
                      className="composer-more"
                      onToggle={(event) => {
                        const menu = event.currentTarget.querySelector("[data-testid='home-composer-more-menu']");
                        if (menu instanceof HTMLElement) pinComposerMenu(menu);
                        if (event.currentTarget.open) {
                          setContextOpen(false);
                          setToolsOpen(false);
                        }
                      }}
                    >
                      <summary>More</summary>
                      <div className="composer-more__menu" ref={(node) => pinComposerMenu(node)} data-testid="home-composer-more-menu">
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
                      </div>
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

                    <button type="submit" disabled={busy || ws.halted || (!draft.trim() && pendingImages.length === 0 && !staged)} className="composer-send inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
                      <Send className="size-4" /> {busy ? "Sending" : "Send"}
                    </button>
                    <button type="button" className="composer-mic-dictate inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-sm" data-testid="composer-mic-dictate" aria-label="Mic" title="Mic types into the field. It does not open Speak." onClick={onDictationMic}>
                      <Mic className="size-4" /> Mic
                    </button>
                    <button type="button" className="gpt-voice inline-flex min-h-11 items-center gap-2 rounded-full bg-[#2f6bff] px-3 text-sm text-white" aria-label="Speak" title="Speak is the call. It does not type into the field." onPointerDown={(event) => { event.preventDefault(); openSpeakStage(); }} onClick={openSpeakStage}>
                      <Volume2 className="size-4" /> Speak
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

              <div className="gpt-starters" ref={(node) => pinShelf(node, "100%", false)} data-testid="start-shelf">
                <p className="mb-1 text-xs uppercase tracking-wide text-muted" style={{ flex: "1 1 100%" }}>Start</p>
                <button type="button" aria-pressed={homeAction === "image"} onClick={() => { setHomeAction("image"); setCommandMode("ask"); }}>
                  <Image className="size-5" /> Create an image
                </button>
                <button type="button" aria-pressed={homeAction === "video"} onClick={() => { setHomeAction("video"); setCommandMode("ask"); }}>
                  <Video className="size-5" /> Create a video
                </button>
                <button type="button" aria-pressed={homeAction === "write"} onClick={() => { setHomeAction("write"); setCommandMode("build"); }}>
                  <FileText className="size-5" /> Write or edit
                </button>
                <button type="button" aria-pressed={homeAction === "search"} onClick={() => { setHomeAction("search"); setCommandMode("research"); }}>
                  <Search className="size-5" /> Search the web
                </button>
              </div>
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
              notice={notice}
              setDraft={setDraft}
              onPickModule={pickModule}
              onPick={(id) => setActiveId(id)}
              onSend={() => void sendInChat()}
              cue={cued}
             onDropCue={(id) => rememberCue(dropCued(cueRef.current, id))}
              onReleaseCue={() => void releaseNextCue()}
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
              scheduledNames={ws.schedules.map((job) => job.name)}
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
                sessionStorage.setItem("adrian-build-draft", text.slice(0, 4000));
                setView("build");
                setNavOpen(false);
              }}
              onOpenHuman={(text) => handToHumanCode(text, "From Chat")}
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
                  <img src="/brand/logo-mark.jpg" alt="" className="size-10 rounded-xl" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Projects</h2>
                    <p className="text-sm text-muted">Records on this device. Oak Bridge and BridgePoint stay outside this app.</p>
                  </div>
                </div>
                <button id="new-project-button" type="button" className="inline-flex min-h-11 items-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => setProjectOpen(true)}>
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
                        <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm text-white" onClick={() => { setChatProjectId(project.id); setProjectChoice(project.id); setActiveId(ws.chats.find((chat) => chat.projectId === project.id)?.id ?? null); setView("chat"); }}>Open chats</button>
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
                  <img src="/brand/logo-mark.jpg" alt="" className="size-8 rounded-lg" />
                  <div>
                    <h2 className="font-display text-3xl font-bold">Memory</h2>
                    <p className="text-sm text-muted">Notes you chose to keep. They stay in this browser, not a remote database.</p>
                  </div>
                </div>
              </div>
              <div className={`glow-card mt-4 grid gap-4 rounded-panel border p-4 md:grid-cols-2 ${memoryChoice === "on" ? "border-ok/40" : "border-danger/40"}`}>
                <div className="flex items-center gap-3">
                  <img src="/brand/logo-mark.jpg" alt="" className="size-12 rounded-2xl" />
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
              <div className="mt-4 flex flex-wrap gap-2">
                {([
                  ["mine", "My Memory"],
                  ["project", "Project Memory"],
                  ["transfer", "Imports & Exports"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={memoryTab === id} onClick={() => setMemoryTab(id)} className={`min-h-11 shrink-0 rounded-panel px-4 text-sm ${memoryTab === id ? "bg-accent text-accent-ink" : "border border-line text-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted">{memoryTab === "project" ? "Project notes stay inside the project you pick." : memoryTab === "transfer" ? "Export is a JSON file with a hash. Import refuses a file whose hash does not match." : "Personal notes are global on this device. You can save and manage them here while chat use is off."}</p>
              {memoryTab === "transfer" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white" onClick={() => void downloadArchive()}>Export archive</button>
                  <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" onClick={() => { setSettingsPane("data"); setView("settings"); }}>Open import settings</button>
                </div>
              )}
              {memoryTab !== "transfer" && <>
              <div className="mt-4 grid gap-3 md:grid-cols-[16rem_1fr]">
                <div className="glow-card rounded-panel border border-line bg-surface p-4 text-sm">
                <p className="font-semibold">Memory overview</p>
                  <p className="mt-3 flex justify-between"><span className="text-muted">Status</span><span className={memoryChoice === "on" ? "text-ok" : "text-danger"}>{memoryChoice === "on" ? "ON" : "OFF"}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Active notes</span><span>{ws.memories.filter((item) => !item.archived).length}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Archived notes</span><span>{ws.memories.filter((item) => item.archived).length}</span></p>
                  <p className="mt-2 flex justify-between"><span className="text-muted">Text size</span><span>{formatBytes(memoryBytes)}</span></p>
                  <p className="mt-3 text-xs text-muted">This size is the note text on this device. It is not a cloud quota.</p>
                </div>
                <div className="grid gap-2">
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
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived
                </label>
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {memories.length === 0 && <li className="glow-card rounded-panel border border-line bg-surface p-6 text-center text-sm text-muted">{memoryQuery.trim() ? "No notes match your search." : "No saved notes in this view yet."}</li>}
                {memories.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-panel border border-line bg-surface p-3 text-sm"
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
                      <p className="whitespace-pre-wrap">{item.text}</p>
                    )}
                    <p className="mt-1 text-xs text-muted">{item.scope}{item.scope === "project" ? (ws.projects.some((project) => project.id === item.projectId) ? "" : " · project removed, note kept") : ""} · {stamp(item.updatedAt)}{item.archived ? " · archived" : ""} · Hold for actions</p>
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
                  <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" style={{ color: "rgb(248 113 113)" }} onClick={() => {
                    const id = noteMenu;
                    setNoteMenu(null);
                    requestProtected("delete", `delete-memory:${id}`, "Delete this note", "The current text and its versions are removed from this browser.", "Approve delete", () => {
                      setWs((prev) => pushAudit({ ...prev, memories: prev.memories.filter((note) => note.id !== id) }, "delete_memory", id, "approved"));
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
            <FleetPanel mode="agents" ws={ws} setWs={setWs} onBotChat={openSavedBotChat}
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
                  const node = document.getElementById(target);
                  const box = node?.closest("details");
                  if (box) box.open = true;
                  node?.scrollIntoView({ behavior: "smooth", block: "center" });
                  setNotice("The paste form is open below. A card is connected only after the server says so.");
                }}
                onDisconnect={() => {
                  void notionDisconnect().then((status) => {
                    setNotion(status);
                    setNotice(status.detail);
                  });
                }}
              />
              <details className="intelligence-group mt-4">
                <summary className="cursor-pointer text-sm font-semibold">Notion search</summary>
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
              </details>
              {notice && <p className="voice-copy rounded-panel border border-line bg-surface px-3 py-2 text-sm text-muted">{presentVoiceCopy(notice)}</p>}
              <details className="intelligence-group">
                <summary className="cursor-pointer text-sm font-semibold">API keys</summary>
              <AiProviderConnections onChange={setCustomAiProviders} />
              </details>
              <details className="intelligence-group">
                <summary className="cursor-pointer text-sm font-semibold">Provider routes</summary>
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
              </details>
            </section>
          )}
          {view === "scheduled" && <FleetPanel key="scheduled" mode="scheduled" ws={ws} setWs={setWs} initialAgentId={botDestinationId} />}
          {view === "tools" && <FleetPanel mode="tools" ws={ws} setWs={setWs} onFailure={(message, retry, surface) => reportFailure(message, surface === "mcp" ? "mcp_tool_failed" : "open_page_failed", surface === "mcp" ? "mcp:tools" : "browser", retry)} />}
          {view === "build" && (
            <section className="page-shell">
              <BuildWorkspace onDiscuss={(text) => handToHumanCode(text, "From Build")} onResult={(text) => {
                const id = sessionStorage.getItem("adrian-human-return");
                if (!id) { handToHumanCode(text, "Build result"); return; }
                sessionStorage.removeItem("adrian-human-return");
                setWs((prev) => appendHumanResult(prev, id, "Build result", text || "Build finished. No output was reported."));
                setActiveId(id);
                setView("code");
                setNotice("Build result saved in the Intelligence thread.");
              }} halted={ws.halted} recording={taskRecording} recordingSeconds={taskSeconds} onOpenSpeak={openSpeakStage} onToggleStop={() => { void toggleStop(); }} onStopRecording={() => void stopTaskRecording()} />
            </section>
          )}
          {view === "code" && (
            <HumanCodePanel
              threads={ws.chats.filter((chat) => isIntelligenceThread(chat.customPersonality)).map((chat) => ({ id: chat.id, title: shownChatTitle(chat), messages: chat.messages.map((message) => ({ role: message.role, content: message.content })) }))}
              activeId={activeId || ""}
              busy={busy}
              notice={notice}
              onNew={openHumanCode}
              onOpen={(id) => { setActiveId(id); setView("code"); }}
              onSend={(id, text, image) => void sendHumanCode(id, text, image)}
              onBuild={(text) => { if (activeId) sessionStorage.setItem("adrian-human-return", activeId); sessionStorage.setItem("adrian-build-draft", text.slice(0, 4000)); setView("build"); setNavOpen(false); }}
              halted={ws.halted}
            />
          )}
          {view === "research" && (
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
              <div className="solid-form mt-4">
                <nav className="mb-3 flex flex-wrap gap-2" aria-label="Research page">
                  {([
                    ["search", "Ask"],
                    ["saved", "Saved"],
                    ["files", "Files"],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" className={`min-h-11 rounded-panel border px-3 text-sm ${researchBand === id ? "border-accent bg-accent text-accent-ink" : "border-line"}`} aria-pressed={researchBand === id} onClick={() => setResearchBand(id)}>{label}</button>
                  ))}
                </nav>
                <div hidden={researchBand !== "search"}>
                <label className="text-sm" htmlFor="research-question">Question</label>
                <textarea id="research-question" value={researchText} onChange={(event) => setResearchText(event.target.value)} placeholder="What do you want to research?" rows={3} className="input-glow mt-2 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
                <button type="button" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={ws.halted || researchPending || !researchText.trim()} onClick={() => void startResearch()}>
                  {researchPending ? "Searching…" : "Start research"}
                </button>
                {researchReportQuestion && <h3 className="mt-3 font-semibold">{researchReportQuestion}</h3>}
                {researchNote ? <p className="mt-3 text-sm text-muted">{researchNote}</p> : null}
                {researchCitations.length === 0 && !researchNote ? (
                  <p className="mt-3 text-sm text-muted">Reports and their sources appear here after a search.</p>
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
                {researchNote && researchCitations.length > 0 ? (
                  <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => {
                    const sources = researchCitations.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => `${item.title}: ${item.url}`).join("\n");
                    setDraft(`Research report for: ${researchReportQuestion || researchText}\n${researchNote}\n\nSources:\n${sources}\n\nFollow-up question: `);
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
                          <button type="button" disabled={researchPending} className="min-h-11 text-left text-sm text-accent" onClick={() => { setResearchText(report.question); setResearchReportQuestion(report.question); setResearchNote(report.summary); setResearchCitations(report.citations); setResearchBand("search"); }}>
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
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="skill-refresh" data-asked-permission="false" onClick={() => setSkillRefresh(refreshSkills())}>Refresh</button>
              </div>
              {skillRefresh ? <p className="text-sm text-muted" data-testid="skill-refresh-status" data-asked-permission={String(skillRefresh.askedPermission)}>{skillRefresh.count} skills refreshed. Permission was not asked.</p> : null}
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
              <div id="owner-skills">
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).filter((skill) => skillBand === "device" ? skill.kind === "built-in" : skillBand === "installed" ? skill.kind === "installed" : skill.kind === "not-installed").map((skill) => {
                  const on = skill.kind !== "not-installed" && enabledSkills[skill.id] !== false;
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
                        {skill.kind !== "not-installed" ? (
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
                          Run
                        </button>}
                        {skill.id === "notion" && <button type="button" className="min-h-11 text-sm text-accent" onClick={() => setView("connected")}>Open connections</button>}
                      </div>
                      {skillResult?.id === skill.id && <p role="status" className="mt-2 whitespace-pre-wrap break-words rounded-panel border border-line p-3 text-sm">{skillResult.text}</p>}
                    </article>
                  );
                })}
                {(skillQuery.trim() ? searchSkills(skillQuery) : SKILLS).filter((skill) => skillBand === "device" ? skill.kind === "built-in" : skillBand === "installed" ? skill.kind === "installed" : skill.kind === "not-installed").length === 0 && <p className="rounded-panel border border-line p-4 text-sm text-muted">No skills match “{skillQuery.trim()}” in this group.</p>}
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
              <div id="owner-library" ref={stackLibrary}>
                {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
                {notice && <p role="status" className="mb-2 text-sm text-muted">{notice}</p>}
                <nav ref={keepGroupRow} className="mb-3 flex flex-wrap gap-2" aria-label="Library groups">
                  {([
                    ["files", "Files"],
                    ["preview", "Preview"],
                    ["media", "Media"],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" className={`min-h-11 rounded-panel border px-3 text-sm ${libraryBand === id ? "border-accent bg-accent text-accent-ink" : "border-line"}`} aria-pressed={libraryBand === id} onClick={() => setLibraryBand(id)}>{label}</button>
                  ))}
                </nav>
                <aside className="library-list text-sm" hidden={libraryBand !== "files"}>
                  <p className="font-semibold">Text copies</p>
                  <p className="mt-2 text-xs text-muted">These are the words you attached, not the original file and not a cloud drive.</p>
                  <ul className="mt-3 space-y-1">
                    {libraryProjectId && <li className="flex flex-wrap items-center gap-3"><span>Project: {ws.projects.find((project) => project.id === libraryProjectId)?.name ?? "Unnamed project"}</span><button type="button" onClick={() => setLibraryProjectId(null)} className="min-h-11 text-accent">All files</button></li>}
                    {!ws.files.some((file) => !libraryProjectId || file.projectId === libraryProjectId) && (
                      <li className="empty-state py-6">
                        <img src="/empty/empty-folder.svg" alt="" />
                        <p className="text-muted">No files yet.</p>
                      </li>
                    )}
                    {ws.files.filter((file) => !libraryProjectId || file.projectId === libraryProjectId).map((file) => (
                      <li key={file.id}>
                        <button type="button" onClick={() => { setOpenFileId(file.id); setLibraryBand("preview"); }} className={`dense-row min-h-11 w-full px-2 text-left ${openFileId === file.id ? "tile-active bg-accent text-accent-ink" : ""}`}>
                          {file.name}
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
                      <p className="font-semibold">{file.name}</p>
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
                    ["sign-in", "Sign in", "Keep this account’s own copy", () => { window.location.assign("/login"); }],
                    ["sign-up", "Sign up", "A new account starts empty", () => { window.location.assign("/login?mode=sign-up"); }],
                    ["keys", "Safe keys", "Open a saved key and copy it", () => setSettingsPane("keys")],
                    ["data", "Data", "What stays in this browser", () => setSettingsPane("data")],
                    ["safety", "Safety", "Stops and confirmations", () => setSettingsPane("safety")],
                  ]},
                  { group: "Preferences", items: [
                    ["general", "Appearance", "Dark, light, motion, or follow this device", () => setSettingsPane("general")],
                    ["voice", "Voice", "Speak voice and pace", () => setSettingsPane("voice")],
                  ]},
                  { group: "Personalization", items: [
                    ["personalization", "Personalization", "How replies sound", () => { setView("chat"); setNavOpen(false); }],
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
                    <div className="settings-index" ref={(node) => pinShelf(node, "100%", false)}>
                    {section.items.map(([id, label, detail, open]) => (
                      <button key={id} type="button" className="adrian-row" style={{ ...menuChip, flex: "1 1 16rem", minWidth: "14rem" }} onClick={open}>
                        <img src={`/brand/logo-mark.jpg`} alt="" width={28} height={28} />
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
                  <section className="adrian-layer intelligence-group" aria-label="Removed sections">
                    <h3>Removed sections</h3>
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
                  <button type="button" className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" style={{ color: "rgb(248 113 113)" }} onClick={() => { rememberHiddenSettings(hideSection(hiddenSettings, settingsMenu)); setSettingsMenu(null); }}>Delete section</button>
                </ActionOverlay>
              )}
              {settingsPane && (
                <button type="button" className="text-sm text-muted" onClick={() => setSettingsPane(null)}>Back</button>
              )}
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
              <div id="settings-connections" hidden={settingsPane !== "connections"} className="space-y-4">
              <div className="settings-card rounded-panel p-4 text-sm">
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
                <AiProviderConnections onChange={setCustomAiProviders} />
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setSettingsPane("keys")}>Open Safe keys</button>
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setView("connected")}>Open connections</button>
              </div>
              <div id="settings-keys" hidden={settingsPane !== "keys"} className="space-y-4">
                <SafeKeysPanel />
              </div>
              <div id="settings-voice" hidden={settingsPane !== "voice"}>
                <VoiceSettingsBlock onReset={() => applyVoiceChoice(DEFAULT_XAI_VOICE)} />
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
                    <p className="mt-1 text-muted">Merge updates matching IDs and adds new records. Replace applies the archive to the browser copy.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => requestProtected("overwrite", "import-merge", "Merge this archive", "Records with matching IDs are replaced by the versions from this archive.", "Merge archive", () => { setWs((prev) => pushAudit(mergeWorkspace(prev, importPreview.workspace), "import_merge", "archive", "merged")); setImportPreview(null); setImportStatus("Archive merged with this workspace."); })}>
                        Merge
                      </button>
                      <button
                        type="button"
                        className="min-h-11 rounded-panel border border-line px-3"
                        onClick={() =>
                          requestProtected("overwrite", `import-replace:${importPreview.workspace.version}`, "Replace this workspace", "Current chats, notes, projects, and files are replaced by the archive.", "Approve replace", () => {
                            setWs((prev) => pushAudit({ ...importPreview.workspace, halted: prev.halted || importPreview.workspace.halted }, "import_replace", "archive", "replaced"));
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
                <button type="button" data-testid="wipe-browser-copy" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setWipeAsk(true)}>
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
        <HandyDictation />
      </main>
      {imagineEdit && (
        <Overlay labelledBy="imagine-edit-title" onDismiss={() => { if (!busy) closeImagineEditor(); }}>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void runImagineEdit(imagineEdit.image, imagineEdit.text); }}>
            <h2 id="imagine-edit-title" className="text-lg font-semibold">Edit image with Imagine</h2>
            <img src={imagineEdit.image} alt="Selected image" className="max-h-40 w-full rounded-panel object-contain" />
            <label className="block text-sm">Describe the edit<textarea autoFocus rows={3} value={imagineEdit.text} onChange={(event) => { setImagineEdit({ ...imagineEdit, text: event.target.value }); setImagineEditError(null); }} className="mt-1 w-full rounded-panel border border-line bg-bg p-2" /></label>
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
          if (file) void onPicked(file).catch(() => setError("Couldn’t read this file. Choose another file to try again."));
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
        <Overlay labelledBy="create-project-title" onDismiss={() => { setProjectName(""); setProjectAbout(""); setError(null); setProjectOpen(false); window.setTimeout(() => document.getElementById("new-project-button")?.focus(), 0); }}>
          <h3 id="create-project-title" className="font-display text-2xl font-bold">Create project</h3>
          <label className="mt-3 block text-sm font-medium" htmlFor="project-name">Project name <span className="text-danger">Required</span></label>
          <input id="project-name" autoFocus value={projectName} onChange={(event) => { setProjectName(event.target.value); if (error === "Name the project.") setError(null); }} placeholder="Name" aria-describedby={error === "Name the project." ? "project-name-error" : undefined} className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
          {error === "Name the project." ? <p id="project-name-error" role="alert" className="mt-2 text-sm text-danger">Enter a project name before creating it.</p> : null}
          <label className="mt-3 block text-sm font-medium" htmlFor="project-description">Description <span className="text-muted">Optional</span></label>
          <textarea id="project-description" value={projectAbout} onChange={(event) => setProjectAbout(event.target.value)} placeholder="What belongs in this project?" rows={3} className="mt-1 w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
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
      {wipeAsk && (
        <Overlay labelledBy="wipe-browser-title" onDismiss={() => setWipeAsk(false)}>
          <h3 id="wipe-browser-title" className="font-display text-2xl font-bold">Clear this browser copy?</h3>
          <p className="mt-2 text-sm text-muted">Chats, notes, projects, files, and bots in this browser are removed. If this browser can reach its server copy, that copy of the same records is replaced. The sign-in account, connected keys, and emergency stop stay. A paired computer is not deleted.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="min-h-11 flex-1 rounded-panel border border-line" onClick={() => setWipeAsk(false)}>Keep data</button>
            <button
              type="button"
              data-testid="confirm-wipe-browser"
              className="min-h-11 flex-1 rounded-panel bg-accent font-semibold text-accent-ink"
              onClick={() => {
                const next = clearedBrowserCopy(wsRef.current);
                setWipeAsk(false);
                setActiveId(null);
                setWipeStatus("Clearing this browser copy…");
                void clearStoredCopy(next).then((saved) => {
                  const message = saved
                    ? "This browser copy was cleared. The server copy of these records was replaced. The sign-in account, connected keys, and emergency stop were not deleted."
                    : "This browser copy was cleared. The server copy was not replaced. The sign-in account, connected keys, and emergency stop were not deleted.";
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
        onSignIn={() => { setSpeakStageOpen(false); window.location.assign("/login"); }}
        onLive={() => void listen({ mode: voiceListening ? "stop" : "start" })}
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
        compactIdle
        authReady={statusSignedIn === true}
        authSignedIn={statusSignedIn === true}
        onSignInRequired={() => setVoiceSignInNotice(true)}
        onCompactSpeak={() => void speak("")}
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
  scheduledNames = [],
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
  onStop: () => void;
  onRename: (title: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onExport: () => void;
  onDelete: () => void;
  onDeleteChat?: (id: string, title: string) => void;
  onDeleteSection?: (label: string, ids: string[]) => void;
  projects?: { id: string; name: string }[];
  pinnedIds?: string[];
  scheduledNames?: string[];
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
  onViewAudit: (auditId: string) => void;
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
              scheduledNames={scheduledNames}
              onOpen={onPick}
              onAction={onConversationAction}
              extras={(ids) => (active && ids.length === 1 && ids[0] === active.id ? [{ label: "Download transcript", onPick: onExport }] : [])}
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
          <details className="thread-mobile-tools mt-3">
            <summary className="min-h-11 cursor-pointer text-sm">Provider</summary>
            <ProviderPicker name="mind-provider-mobile" choices={choices} choice={providerChoice} onChoose={onProvider} logicRoutes={logicRoutes} grokVerified={grokVerified} />
            <div className="mt-3">
              <ModelTierPicker name="mind-tier-mobile" tier={modelTier} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
          <ChatMediaGallery messages={active?.messages} onUseInComposer={onSaveImage} onEditImagine={onEditImagine} onDownload={onDownloadImage} />
          {(!active || active.messages.length === 0) && !busy && (
            <div className="grid min-h-64 place-items-center text-center">
              <ChatEmptyHero
                title={active?.botProvider || active?.botTier ? `${active.botProvider ?? "Chat’s provider"} · ${active.botTier ?? "Chat’s tier"}` : undefined}
                subtitle={active?.agentId ? "This conversation belongs to the bot." : undefined}
              />
            </div>
          )}
          {active?.messages.map((msg) => {
            const last = active.messages.at(-1);
            return (
            <article key={msg.id} className="w-full max-w-none px-1 py-2 text-sm">
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
                  <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={() => (speaking ? onStopSpeak?.() : onSpeak(msg.content, msg.id))}>
                    {speaking ? "Stop" : "Read aloud"}
                  </button>
                )}
                {msg.role === "assistant" && last?.id === msg.id && (
                  <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={busy ? onStop : onRegenerate} disabled={halted}>
                    {busy ? "Stop generating" : "Regenerate"}
                  </button>
                )}
                {msg.role === "assistant" && (
                  <details className="relative">
                    <summary className="min-h-11 cursor-pointer list-none rounded-full px-3 text-xs">More</summary>
                    <div className="absolute bottom-12 left-0 z-20 flex min-w-44 flex-col rounded-2xl border border-line bg-bg p-1">
                      <button type="button" className="min-h-11 px-3 text-left text-xs" onClick={() => onOpenBuild(msg.content)}>Open in Build</button>
                      <button type="button" className="min-h-11 px-3 text-left text-xs" onClick={() => onOpenHuman(msg.content)}>Open in Intelligence</button>
                    </div>
                  </details>
                )}
                {msg.role === "assistant" && (
                  <span role="group" aria-label="Rate this reply" className="flex flex-wrap items-center gap-1 text-xs text-muted">
                    Rate
                    {([1, 2, 3, 4, 5] as const).map((score) => (
                      <button
                        key={score}
                        type="button"
                        aria-label={`${score} out of 5`}
                        aria-pressed={ratings.find((item) => item.messageId === msg.id)?.score === score}
                        className={`min-h-11 min-w-11 rounded-panel ${ratings.find((item) => item.messageId === msg.id)?.score === score ? "border border-accent bg-accent/15 font-semibold text-accent" : ""}`}
                        onClick={() => onRate(msg.id, score, msg.model ?? null)}
                      >
                        {score}
                      </button>
                    ))}
                  </span>
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
          {busy && liveText && (
            <article className="w-full max-w-none rounded-panel border border-line bg-surface px-3 py-2 text-sm">
              <p className="mb-1 text-xs text-muted">{modelTier} · writing</p>
              <p className="whitespace-pre-wrap">{liveText}</p>
            </article>
          )}
          {busy && !liveText && toolTimeline.length === 0 && (
            <div className="w-full max-w-none space-y-2 rounded-panel border border-line/70 bg-surface/80 p-3" aria-live="polite">
              <p className="text-xs text-muted">{active?.messages.at(-1)?.content.startsWith("/video") ? "Rendering the video." : active?.messages.at(-1)?.content.startsWith("/imagine") ? "Creating the image." : "Waiting for Grok."}</p>
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
          <div className="flex items-center gap-2"><VoiceLevelMeter level={voiceLevel} listening={voiceListening} /></div>
        </div>
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
          <div className="next-guesses flex gap-2 overflow-x-auto px-3 pb-1" data-testid="next-guesses">
            <button type="button" className="suggestion-chip shrink-0" onClick={() => setDraft("Go deeper on that")}>Go deeper</button>
            <button type="button" className="suggestion-chip shrink-0" onClick={() => setDraft("Make that shorter")}>Make it shorter</button>
            <button type="button" className="suggestion-chip shrink-0" onClick={() => setDraft("Turn that into an image")}>Turn that into an image</button>
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
          <div className="composer-toolbar mt-2 flex flex-wrap items-center gap-2">
            <details className="composer-more" onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.stopPropagation();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }} onToggle={(event) => {
              const menu = event.currentTarget.querySelector("[data-testid='composer-more-menu']");
              if (menu instanceof HTMLElement) pinComposerMenu(menu);
            }}>
              <summary>More</summary>
              <div className="composer-more__menu" ref={(node) => pinComposerMenu(node)} data-testid="composer-more-menu">
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
            <button type="button" className="min-h-11 rounded-panel border border-line/80 bg-white/5 px-3 text-sm" disabled={!lastReply && !speaking} onClick={() => (speaking ? onStopSpeak?.() : lastReply && onSpeak(lastReply.content, lastReply.id))}>
              {speaking ? "Stop" : "Read aloud"}
            </button></div>
            
            <button type="submit" disabled={halted || (busy ? !draft.trim() : (!draft.trim() && pendingImages.length === 0 && !stagedName))} className="composer-send min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">{busy ? "Cue" : "Send"}</button>
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
            <ModelTierPicker name="mind-tier-side" tier={modelTier} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />
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
      <p className="mt-1 text-xs text-muted" style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }}>
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
  const groupOf = (item: { id: string; label: string }) => {
    const label = item.label.toLowerCase();
    if (item.id === "grok" || label.startsWith("grok")) return "Grok";
    if (item.id === "openai" || label.includes("gpt") || label.includes("astra") || label.includes("sol") || label.includes("luna")) return "OpenAI";
    if (item.id.startsWith("custom:")) return "Saved";
    return "Other";
  };
  const groups = ["Grok", "OpenAI", "Other", "Saved"].map((title) => ({
    title,
    items: choices.filter((item) => groupOf(item) === title && item.enabled),
  })).filter((group) => group.items.length > 0);
  const selected = choices.find((item) => item.id === choice);
  return (
    <div className="provider-pack">
      <p className="text-sm font-semibold">Providers</p>
      <p className="mt-1 text-xs text-muted">{selected ? selected.label : "Choose a provider"}</p>
      {groups.map((group) => (
        <details key={group.title} className="provider-group" open={group.items.some((item) => item.id === choice) || undefined}>
          <summary className="flex items-center gap-2">
            {PRODUCT_LOGO[group.title.toLowerCase()] ? <img src={PRODUCT_LOGO[group.title.toLowerCase()]} alt="" width={16} height={16} className="size-4 rounded" /> : null}
            {group.title}
            {group.title === "Saved" ? <span className="text-xs text-muted">{group.items.length} models</span> : null}
          </summary>
          <div className={group.title === "Saved" ? "max-h-64 overflow-y-auto" : undefined} style={group.title === "Saved" ? { overflowX: "hidden" } : undefined}>
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
