import type { Chat } from "@/lib/mind/types";
import { CONVERSATIONAL_PERSONALITIES, type PersonalityId } from "@/lib/mind/personalities";
import { type ModuleSuggestion } from "@/lib/intent/module-suggestions";
import { type CuedMessage } from "@/lib/mind/message-cue";
import { type ConversationAction } from "@/lib/mind/conversation-actions";
import { type DictationMachineState } from "@/lib/mind/voice/dictation-machine";
import { type Autonomy } from "@/lib/mind/policy";
import { type ComposerModeId } from "@/lib/mind/composer-modes";
import { type ConsultModule } from "@/lib/mind/model-consult";
import { type ResponseRating, type RoutingMode } from "@/lib/mind/routing-modes";
import { type LogicRouteId, type LogicRoutePublic } from "@/lib/mind/logic-routes";
import { type ImageAttachment } from "@/lib/mind/media";
import { type ModelTier, type ModelTierCatalogRow } from "@/lib/mind/model-tiers";
import { agentActivityFromTimeline, connectedServicesRail, elapsedMs, formatElapsed, recentTasksFromAudit, systemStatusRail, timelineCounts, type ToolTimelineRow } from "@/lib/mind/tools-timeline";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ComposerBar, type ComposerModelId, DictationPill as PreviewDictationPill, LiveSpeakControl, LiveVoiceBar as PresentationalLiveVoiceBar, VoiceModeStage } from "@/components/mind/voice-ui";
import { routeForBotChat } from "@/lib/mind/bot-model";
import { INITIAL_MESSAGE_WINDOW, messageWindow } from "@/lib/mind/render-window";
import { Image, Mic, MicOff, Paperclip, Camera, Plus, Square, Volume2 } from "lucide-react";
import { ConversationSections } from "@/components/mind/conversation-sections";
import { MemoryChatToggle } from "@/components/mind/memory-chat-toggle";
import { ChatMediaGallery } from "@/components/mind/media/chat-media-gallery";
import { ChatEmptyHero } from "@/components/mind/chat-empty-hero";
import { AnswerTabs, MessageBody } from "@/components/mind/message-body";
import { ContextReceiptDetails } from "@/components/mind/context-receipt";
import { VoiceStageReceipt } from "@/components/mind/voice-stage-receipt";
import { replyActions, replyHasSources } from "@/lib/mind/reply-actions";
import { MemorySavedIndicator } from "@/components/mind/memory-saved-indicator";
import { VoiceLevelMeter } from "@/components/mind/voice-level-meter";
import { ModuleSuggestions } from "@/components/mind/module-suggestions";
import { AttachmentChips } from "@/components/mind/media/attachment-chips";
import { MenuCluster, ComposerMore, menuChip } from "@/components/mind/menu-material";
import { VoiceWaveform } from "@/components/mind/voice-waveform";
import { voiceMicAriaLabel, VOICE_TOGGLE_SHORTCUT } from "@/lib/mind/voice/shortcut";
import { conversationSection } from "@/lib/mind/conversation-sections";
import { skillReceiptSummary } from "@/lib/mind/skill-activation";

import { BrowserDictationControl, VoiceModeButton, ComposerEffortControl, ModelTierPicker, ProviderPicker } from "./chat-controls";

import { stamp } from "./chat-presentation";
import { ConversationComparison } from "./conversation-comparison";

/** Conversation surface isolated from account, persistence and service orchestration. */

export function ChatPane({
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
  onReplyVersion,
  revealMessageId,
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
  speakingMessageId,
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
  consultHelpers,
  onConsultHelper,
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
  tierCatalog = [],
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
  onEdit: (messageId: string, text: string) => Promise<boolean>;
  onReplyVersion?: (messageId: string, versionId: string) => void;
  revealMessageId?: string;
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
  speakingMessageId?: string | null;
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
  consultHelpers?: string[];
  onConsultHelper?: (id: string) => void;
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
  tierCatalog?: readonly ModelTierCatalogRow[];
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
  const [copyError, setCopyError] = useState<string | null>(null);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(() => new Set());
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
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [messageCount, setMessageCount] = useState(INITIAL_MESSAGE_WINDOW);
  useEffect(() => { setMessageCount(INITIAL_MESSAGE_WINDOW); setDismissedMessages(new Set()); }, [active?.id]);
  const renderedMessages = useMemo(() => messageWindow(active?.messages ?? [], messageCount, revealMessageId), [active?.messages, messageCount, revealMessageId]);
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
        {active?.branchFrom ? <p className="px-4 py-2 text-xs text-muted">Edited branch. <button type="button" className="min-h-9 px-2 underline" onClick={() => onPick(active.branchFrom!.chatId)}>Open source conversation</button></p> : null}
        <div className="chat-head px-4 pt-4" hidden={Boolean(active?.messages.length)}>
          <h2 className="font-display text-3xl font-bold">{active?.title || "AI Chat"}</h2>
         {active && customPersonality.trim() ? <p className="mt-1 text-sm text-muted">{active.title} is open in Chat. Its saved instructions are used for the next reply.</p> : null}
          {active?.temporary && <div className="text-xs text-muted">Excluded from workspace archives by default</div>}
          {active?.messages.some((message) => message.images?.some((image) => !image.dataUrl)) && <div className="text-xs text-muted">Some image copies are still loading or unavailable on this device. Their references remain included in the transcript.</div>}
          <details className="thread-mobile-tools mt-3">
            <summary className="min-h-11 cursor-pointer text-sm">Provider</summary>
            <ProviderPicker name="mind-provider-mobile" choices={choices} choice={providerChoice} onChoose={onProvider} logicRoutes={logicRoutes} grokVerified={grokVerified} />
            <div className="mt-3">
              {routeId === "grok" && <ModelTierPicker name="mind-tier-mobile" tier={modelTier} tierCatalog={tierCatalog} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />}
            </div>
          </details>
        </div>
        <details id="thread-chat-settings" className="thread-chat-settings" open={chatSettingsOpen} onToggle={(event) => onChatSettingsToggle(event.currentTarget.open)}>
           <summary>Chat settings</summary>
            <p className="text-sm text-muted">Only a configured provider can be selected. Another provider is not substituted.</p>
            <ConversationComparison chats={chats} activeId={active?.id} onOpen={onPick} />
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
        {detached && <button type="button" className="jump-to-latest" onClick={() => {
          following.current = true;
          setDetached(false);
          if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
        }}>Jump to latest</button>}
          <div ref={turns} className="space-y-3">
          {copyError ? <p role="alert" className="text-sm text-danger">{copyError}</p> : null}
          <ChatMediaGallery messages={active?.messages} onUseInComposer={onSaveImage} onEditImagine={onEditImagine} onDownload={onDownloadImage} />
          {(!active || active.messages.length === 0) && !busy && (
            <div className="grid min-h-64 place-items-center text-center">
              <ChatEmptyHero
                title={chatRoute.fromBot ? `${routeLabel} · ${chatRoute.modelTier}` : routeLabel}
                subtitle={active?.agentId ? "This conversation belongs to the bot." : undefined}
              />
            </div>
          )}
          {renderedMessages.hiddenCount > 0 ? <button type="button" className="min-h-11 w-full rounded-panel border border-line px-4 text-sm" onClick={() => {
            const pane = transcript.current; const height = pane?.scrollHeight ?? 0; const top = pane?.scrollTop ?? 0;
            following.current = false; setDetached(true); setMessageCount((current) => current + INITIAL_MESSAGE_WINDOW);
            requestAnimationFrame(() => { if (pane) pane.scrollTop = top + pane.scrollHeight - height; });
          }}>Load earlier messages ({renderedMessages.hiddenCount})</button> : null}
          {renderedMessages.messages.filter((msg) => !dismissedMessages.has(msg.id)).map((msg) => {
            const last = active?.messages.at(-1);
            return (
            <article key={msg.id} id={"message-" + msg.id} tabIndex={-1} className={`turn w-full max-w-none px-1 py-2 text-sm ${msg.role === "user" ? "turn-user" : "turn-assistant"}`}>
              <p className="mb-1 text-xs text-muted">{msg.role === "user" ? "You" : [msg.provider, msg.model].filter(Boolean).join(" · ") || "Assistant · model unreported"} · {stamp(msg.at)}</p>
              {msg.partialReply ? <details className="mb-3 rounded-panel border border-line p-3" open><summary>Incomplete response · not included as a completed answer</summary><MessageBody text={msg.partialReply} /><button type="button" className="min-h-11 px-3 text-xs" onClick={() => { void navigator.clipboard?.writeText(msg.partialReply!).then(() => setCopiedId(msg.id)).catch(() => setCopyError("Copy failed. Select the text and copy it manually.")); }}>{copiedId === msg.id ? "Copied incomplete response" : "Copy incomplete response"}</button></details> : null}
              {msg.replyVersions && msg.replyVersions.length > 1 ? <details className="mb-2 text-sm"><summary>Answer versions ({msg.replyVersions.length})</summary><label>Use version <select className="min-h-11 border border-line rounded-panel bg-surface px-2" aria-label="Answer version" value={msg.selectedReplyVersionId} disabled={busy} onChange={(event) => onReplyVersion?.(msg.id, event.target.value)}>{msg.replyVersions.map((version, index) => <option key={version.id} value={version.id}>{index + 1} · {version.provider ?? version.model ?? "Provider unreported"} · {stamp(version.at)}</option>)}</select></label><div className="mt-2 grid gap-3 md:grid-cols-2">{msg.replyVersions.map((version, index) => <details key={version.id} className="rounded-panel border border-line p-2"><summary>Compare version {index + 1}</summary><MessageBody text={version.content} /></details>)}</div></details> : null}
              {msg.contextReceipt && <ContextReceiptDetails receipt={msg.contextReceipt} />}
              {msg.voiceStages && <VoiceStageReceipt receipt={msg.voiceStages} />}
              {msg.deliveryMode && <p className="text-xs text-muted">Delivery: {msg.deliveryMode === "streamed" ? "provider stream" : "completed response buffered by this route"}</p>}
              {msg.consultation?.length ? <details className="text-xs"><summary className="min-h-11 cursor-pointer">Consultation · {msg.consultation.length} selected helpers</summary>{msg.consultation.map((item) => <div key={item.id} className="my-2 rounded-panel border border-line p-2"><p>{item.id} · {item.ok ? "returned" : "failed"}{item.truncated ? ` · excerpt from ${item.originalCharacters} characters` : ""}</p><p>{item.error}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{item.text}</pre></div>)}</details> : null}
              {msg.skillReceipts?.length ? <details className="mb-2 text-xs text-muted"><summary className="min-h-11 cursor-pointer">Skills considered ({msg.skillReceipts.length})</summary><ul>{msg.skillReceipts.map((item) => <li key={item.skillId}>{item.skillId} · version {item.version} · {skillReceiptSummary(item)}</li>)}</ul></details> : null}
              {msg.researchRefs?.length ? <details className="mb-2 text-xs text-muted"><summary>Saved research references</summary><ul>{msg.researchRefs.map((item) => <li key={`${item.reportId}:${item.version}`}>{item.question} · version {item.version} · {item.reportId} · retrieved {stamp(item.at)}</li>)}</ul></details> : null}
              {msg.memoryUsedIds?.length ? <details className="mb-2 text-xs text-muted"><summary>{msg.memoryUsedIds.length} saved notes used for this response</summary><ul>{msg.memoryUsedIds.map((id) => <li key={id}>{id}</li>)}</ul></details> : null}
              {msg.requestedModel && msg.model !== msg.requestedModel && (
                <p className="mb-1 break-words text-xs text-muted">Requested {msg.requestedModel}</p>
              )}
              {msg.delivery && !(busy && msg.delivery === "submitted" && last?.id === msg.id) && (
                <p className="mb-1 text-xs text-muted" role="status">
                  {msg.deliveryRoute && <span>{msg.deliveryRoute.provider} · {msg.deliveryRoute.model ?? msg.deliveryRoute.tier}. </span>}
                  {msg.delivery === "stopped" ? "Stopped. Received text is retained as incomplete. The provider outcome may still be unknown." : msg.delivery === "failed" ? "The provider did not complete this reply." : "No finished reply was saved. The provider may already have received this message."}
                </p>
              )}
              {editingId === msg.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onEdit(msg.id, editDraft).then((accepted) => { if (accepted) setEditingId(null); });
                  }}
                >
                  <textarea aria-label="Edit message" value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} className="w-full rounded-panel border border-line bg-bg px-3 py-2 text-sm" />
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
                    <button type="button" className="min-h-11 rounded-full px-3 text-xs" onClick={() => setDismissedMessages((current) => new Set([...current, msg.id]))}>Dismiss</button>
                  </>
                ) : null}
                {msg.kind === "error" ? null : <>
                <button
                  type="button"
                  className="min-h-11 rounded-full px-3 text-xs"
                  onClick={() => {
                    setCopyError(null);
                    if (!navigator.clipboard) { setCopyError("Clipboard is unavailable. Select the text and copy it manually."); return; }
                    void navigator.clipboard.writeText(msg.content).then(() => {
                      setCopiedId(msg.id);
                    }).catch(() => { setCopiedId(null); setCopyError("Copy failed. Select the text and copy it manually."); });
                  }}
                >
                  {copiedId === msg.id ? "Copied" : "Copy"}
                </button>
                {msg.role === "assistant" && (
                  <button type="button" className="chat-button chat-button--ghost" onClick={() => (speaking && speakingMessageId === msg.id ? onStopSpeak?.() : onSpeak(msg.content, msg.id))}>
                    <Volume2 size={20} strokeWidth={1.75} /> {replyActions({ role: "assistant", busy: false, speaking: speaking && speakingMessageId === msg.id, hasSources: replyHasSources(msg.content) }).includes("stop-playback") ? "Stop" : "Read aloud"}
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
                      {!active?.temporary && <label className="px-3 py-2 text-xs">Rate this reply
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
                {msg.role === "user" && active?.memory === "on" && (
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
        </div>
        <form
          className="floating-composer command-card composer-dock thread-composer p-3" data-composer="floating" data-expanded={composerExpanded ? "true" : "false"}
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
          <button type="button" className="min-h-9 self-end rounded-full px-3 text-xs md:hidden" aria-expanded={composerExpanded} onClick={() => setComposerExpanded((value) => !value)}>{composerExpanded ? "Compact draft" : "Expand draft"}</button>
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
                  <ComposerEffortControl mode={composerEffort} onChoose={onComposerEffort} consultModules={consultModules} consultModel={consultModel} onConsultModel={onConsultModel} consultHelpers={consultHelpers} onConsultHelper={onConsultHelper} />
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
            {routeId === "grok" && <ModelTierPicker name="mind-tier-side" tier={modelTier} tierCatalog={tierCatalog} onChoose={onModelTier} logicRoute={logicRoute} logicRoutes={logicRoutes} onChooseLogic={onChooseLogic} />}
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

function chatBucket(chat: Chat) {
  return conversationSection(chat);
}
