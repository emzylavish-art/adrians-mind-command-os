/**
 * Wired Grok composer + live-call chrome.
 * Self-contained Tailwind so it works without Visual Polish styles.css.
 * Keep VP class names for post-merge CSS override.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  AudioLines,
  Mic,
  MicOff,
  Phone,
  Plus,
  ScreenShare,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { analyzeImageFile } from "@/lib/mind/server";
import { useLiveVoiceSession } from "@/lib/mind/voice-live/use-live-voice-session";
import { isLiveVoiceOccupied } from "@/lib/mind/voice-live/occupancy";
import {
  MAX_TEXT_FILE_CHARS,
  MAX_VIDEO_FRAMES,
  REALTIME_NATIVE_INPUT_IMAGE,
  SCREEN_FRAME_INTERVAL_MS,
  validateAttachment,
} from "@/lib/mind/voice-live/attachments";
import { barRootStyle } from "@/lib/mind/voice-live/bar-state";
import { getVoiceMode, setVoiceModeStore } from "@/lib/mind/voice/mode-store";
import { toggleVoiceMode, type VoiceRoutingMode } from "@/lib/mind/voice/mode";
import {
  readStoredVoiceChoice,
  writeStoredVoiceChoice,
  type XaiBuiltinVoice,
} from "@/lib/mind/voice/voices";
import { VoicePicker } from "@/components/mind/voice-picker";
import { VoiceModeBadge } from "@/components/mind/voice-mode-badge";
import { matchesVoiceToggleShortcut } from "@/lib/mind/voice/shortcut";
import type { LiveVoiceUiAttr } from "@/lib/mind/voice-live/types";
import {
  captureCameraJpeg,
  fileToBase64,
  readTextFile,
  sampleVideoFrames,
  startMediaFrameStream,
  type FrameStreamHandle,
} from "./frame-capture";
import { shouldCloseSettingsOnEscape, shouldEndCallOnEscape } from "./settings-popover";

export type LiveVoiceBarProps = {
  isOverlayMicOpen: () => boolean;
  stopOverlayMic: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  onChatSend?: (text: string) => void;
  onChatAttachText?: (text: string, name: string) => void;
  dictating?: boolean;
  onDictateToggle?: () => void;
  askValue?: string;
  onAskChange?: (value: string) => void;
  modelPickerSlot?: ReactNode;
  onAttachFileClick?: () => void;
};

const PILL =
  "live-voice-bar__round live-call-pill flex h-14 min-h-[3.5rem] w-full min-w-0 items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1e] text-zinc-100 shadow-sm transition hover:bg-[#2a2a2c]";

export function LiveVoiceBar(props: LiveVoiceBarProps) {
  const live = useLiveVoiceSession({
    isOverlayMicOpen: props.isOverlayMicOpen,
    onUserTranscript: props.onUserTranscript,
    onAssistantTranscript: props.onAssistantTranscript,
    onError: props.onError,
    onNotice: props.onNotice,
  });

  const inCall = live.active;
  const uiAttr: LiveVoiceUiAttr = live.uiAttr || "off";
  const dictationState = props.dictating ? "recording" : "idle";

  const [localAsk, setLocalAsk] = useState("");
  const ask = props.askValue !== undefined ? props.askValue : localAsk;
  const setAsk = (value: string) => {
    if (props.onAskChange) props.onAskChange(value);
    else setLocalAsk(value);
  };

  const [attachOpen, setAttachOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  const [screenOn, setScreenOn] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceRoutingMode>(() => getVoiceMode());
  const [voiceChoice, setVoiceChoice] = useState<XaiBuiltinVoice>(() =>
    readStoredVoiceChoice(typeof localStorage === "undefined" ? null : localStorage),
  );

  const screenRef = useRef<FrameStreamHandle | null>(null);
  const pendingScreenStream = useRef<MediaStream | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const stopScreen = useCallback(() => {
    screenRef.current?.stop();
    screenRef.current = null;
    if (pendingScreenStream.current) {
      for (const t of pendingScreenStream.current.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
      pendingScreenStream.current = null;
    }
    setScreenOn(false);
  }, []);

  const endEverything = useCallback(() => {
    stopScreen();
    live.end();
    setAttachOpen(false);
    setSettingsOpen(false);
  }, [live, stopScreen]);

  // Esc / Ctrl+Shift+V: attached for whole bar lifetime (idle + call).
  // Settings dialog: close popover only (stopPropagation + dialog check).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (shouldCloseSettingsOnEscape(event.key, settingsOpen)) {
          event.preventDefault();
          event.stopPropagation();
          setSettingsOpen(false);
          return;
        }
        const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]'));
        const callActive = live.active || isLiveVoiceOccupied();
        if (
          !shouldEndCallOnEscape({
            key: event.key,
            settingsOpen,
            callActive,
            modalOpenInDom: modalOpen,
          })
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        endEverything();
        return;
      }
      if (!matchesVoiceToggleShortcut(event)) return;
      if (!live.active && !isLiveVoiceOccupied()) return;
      event.preventDefault();
      event.stopPropagation();
      endEverything();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [endEverything, live.active, settingsOpen]);

  useEffect(() => {
    if (!live.active) stopScreen();
  }, [live.active, stopScreen]);

  useEffect(() => () => stopScreen(), [stopScreen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointer = (event: MouseEvent) => {
      const root = settingsRef.current;
      const target = event.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointer, true);
    return () => document.removeEventListener("mousedown", onPointer, true);
  }, [settingsOpen]);

  const ensureLive = useCallback(async () => {
    if (live.active) return true;
    if (props.isOverlayMicOpen()) props.stopOverlayMic();
    live.pressMic();
    await new Promise((r) => setTimeout(r, 50));
    return true;
  }, [live, props]);

  const pushVisionFallback = useCallback(
    async (jpegBase64: string, caption: string) => {
      if (!live.active) {
        props.onNotice?.(
          "Not live yet — starting live voice, then attaching via chat/vision fallback.",
        );
        await ensureLive();
      } else if (!REALTIME_NATIVE_INPUT_IMAGE) {
        props.onNotice?.("Realtime ignores input_image — using chat/vision fallback.");
      }
      let analysis = "";
      try {
        const result = await analyzeImageFile({
          data: {
            name: "live-attach.jpg",
            bytes: Math.ceil((jpegBase64.length * 3) / 4),
            imageBase64: jpegBase64.slice(0, 180_000),
          },
        });
        if (result && typeof result === "object" && "text" in result && result.text) {
          analysis = String(result.text).slice(0, 1500);
        } else if (result && typeof result === "object" && "error" in result && result.error) {
          analysis = `Vision note: ${String(result.error)}`;
        }
      } catch {
        analysis = "Vision analysis was unavailable.";
      }
      const prompt = [caption.trim() || "Describe this attached image briefly.", analysis ? `Vision summary: ${analysis}` : ""]
        .filter(Boolean)
        .join("\n");
      const sent = live.sendText(prompt);
      if (!sent) {
        props.onChatAttachText?.(prompt, "live-attach.jpg");
        props.onNotice?.("Attached to normal chat (live session was not open).");
      } else {
        live.sessionRef.current?.attachImageContext(jpegBase64, caption);
      }
    },
    [ensureLive, live, props],
  );

  const onAskSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = ask.trim();
    if (!text) return;
    if (inCall && live.state.phase !== "connecting" && live.state.phase !== "reconnecting") {
      const ok = live.sendText(text);
      if (ok) {
        setAsk("");
        props.onNotice?.("Sent into the live session.");
        return;
      }
      props.onError?.("Could not send into the live session. Sending via chat instead.");
    } else if (live.state.phase === "connecting" || live.state.phase === "reconnecting") {
      props.onNotice?.("Live voice is still connecting — sending via normal chat.");
    }
    if (!props.onChatSend) {
      props.onError?.("Chat send is unavailable.");
      return;
    }
    props.onChatSend(text);
    setAsk("");
  };

  /** Speak: stop dictation first, then start the call (never refuse). */
  const startSpeak = () => {
    if (props.dictating || props.isOverlayMicOpen()) {
      props.stopOverlayMic();
      props.onNotice?.("Stopped dictation — starting live call.");
    }
    if (live.state.phase === "connecting" || live.state.phase === "reconnecting") {
      live.pressMic(); // cancel
      return;
    }
    if (!live.active) live.pressMic();
  };

  const onDictate = () => {
    if (live.active) {
      props.onNotice?.("End the live call before using dictation.");
      return;
    }
    props.onDictateToggle?.();
  };

  /**
   * Screen share: call getDisplayMedia synchronously in the click stack
   * (before any await on connect) to preserve user activation.
   */
  const onScreenClick = () => {
    if (screenOn) {
      stopScreen();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = "Screen share was cancelled or isn't available.";
      setAttachMsg(msg);
      props.onError?.(msg);
      props.onNotice?.(msg);
      return;
    }
    let streamPromise: Promise<MediaStream>;
    try {
      streamPromise = navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (caught) {
      const msg = "Screen share was cancelled or isn't available.";
      setAttachMsg(msg);
      props.onError?.(msg);
      void caught;
      return;
    }
    void (async () => {
      try {
        const stream = await streamPromise;
        pendingScreenStream.current = stream;
        // Allowed while connecting — attach frames once live is up.
        if (!live.active) {
          props.onNotice?.("Starting live voice for screen share…");
          await ensureLive();
        }
        const handle = await startMediaFrameStream(
          stream,
          async (b64) => {
            void b64;
            if (live.active) live.sendText("(Live screen frame received — describe if relevant.)");
          },
          SCREEN_FRAME_INTERVAL_MS,
        );
        screenRef.current = handle;
        pendingScreenStream.current = null;
        setScreenOn(true);
        stream.getVideoTracks()[0]?.addEventListener("ended", () => stopScreen());
      } catch {
        const msg = "Screen share was cancelled or isn't available.";
        setAttachMsg(msg);
        props.onError?.(msg);
        props.onNotice?.(msg);
        setScreenOn(false);
      }
    })();
  };

  const onPlusItem = async (id: "camera" | "photo" | "video" | "files") => {
    setAttachOpen(false);
    if (id === "camera") {
      const snap = await captureCameraJpeg();
      if (!snap.ok) {
        setAttachMsg(snap.error);
        props.onError?.(snap.error);
        return;
      }
      await pushVisionFallback(snap.base64, "Camera snapshot");
      return;
    }
    if (id === "photo") photoInputRef.current?.click();
    else if (id === "video") videoInputRef.current?.click();
    else {
      if (props.onAttachFileClick) props.onAttachFileClick();
      else fileInputRef.current?.click();
    }
  };

  const handlePhotoFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const check = validateAttachment(file, "photo");
    if (!check.ok) {
      setAttachMsg(check.error);
      return;
    }
    try {
      await pushVisionFallback(await fileToBase64(file), `Photo: ${file.name}`);
    } catch {
      setAttachMsg("Could not read that photo.");
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleVideoFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const check = validateAttachment(file, "video");
    if (!check.ok) {
      setAttachMsg(check.error);
      return;
    }
    const sampled = await sampleVideoFrames(file, MAX_VIDEO_FRAMES);
    if (!sampled.ok) {
      setAttachMsg(sampled.error);
      return;
    }
    for (const frame of sampled.frames.slice(0, 3)) {
      await pushVisionFallback(frame, `Video frame from ${file.name}`);
    }
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const handleTextFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const check = validateAttachment(file, "files");
    if (!check.ok) {
      setAttachMsg(check.error);
      return;
    }
    try {
      const text = await readTextFile(file, MAX_TEXT_FILE_CHARS);
      const payload = `Attached file ${file.name}:\n${text}`;
      if (live.active) live.sendText(payload);
      else props.onChatAttachText?.(payload, file.name);
    } catch {
      setAttachMsg("Could not read that file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const style = barRootStyle(live.level) as CSSProperties;
  const muted = live.muted || uiAttr === "muted";

  const fileInputs = (
    <>
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handlePhotoFiles(e.target.files)} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => void handleVideoFiles(e.target.files)} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.html,.css,.yml,.yaml,.toml,.xml,.log,text/*,application/json"
        className="hidden"
        onChange={(e) => void handleTextFiles(e.target.files)}
      />
    </>
  );

  const plusMenu = (forLive: boolean) =>
    attachOpen ? (
      <ul
        className={`live-voice-bar__plus-menu absolute z-50 min-w-[12rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 py-1 shadow-2xl ${
          forLive ? "bottom-12 left-0" : "bottom-12 left-0"
        }`}
        role="menu"
        aria-label="Add media"
      >
        {(["camera", "photo", "video", "files"] as const).map((id) => (
          <li key={id} role="none">
            <button
              type="button"
              role="menuitem"
              className="live-voice-bar__plus-item flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-100 hover:bg-zinc-800"
              data-testid={`live-voice-bar-attach-${id}`}
              onClick={() => void onPlusItem(id)}
            >
              <span className={`lvb-ico lvb-ico--${id}`} aria-hidden="true" />
              {id[0]!.toUpperCase() + id.slice(1)}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  const settingsPopover = settingsOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live voice settings"
      className="absolute right-0 bottom-16 z-50 w-72 rounded-2xl border border-white/10 bg-zinc-900 p-3 text-zinc-100 shadow-2xl"
      onKeyDown={(event) => {
        if (shouldCloseSettingsOnEscape(event.key, true)) {
          event.preventDefault();
          event.stopPropagation();
          setSettingsOpen(false);
        }
      }}
    >
      <VoiceModeBadge
        mode={voiceMode}
        listening={uiAttr === "listening" || uiAttr === "user-speaking" || uiAttr === "assistant-speaking"}
        onToggle={() => setVoiceMode(setVoiceModeStore(toggleVoiceMode(voiceMode)))}
      />
      <div className="mt-3">
        <VoicePicker
          value={voiceChoice}
          onChange={(v) => {
            setVoiceChoice(v);
            writeStoredVoiceChoice(v, typeof localStorage === "undefined" ? null : localStorage);
          }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" className="text-xs" onClick={live.toggleSpeaker} aria-pressed={live.speakerMuted}>
          Output {live.speakerMuted ? "muted" : "on"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={live.volume}
          aria-label="Output volume"
          onChange={(e) => live.setOutputVolume(Number(e.target.value))}
        />
      </div>
    </div>
  ) : null;

  const statusLine =
    attachMsg || live.error ? (
      <p
        className={`mt-2 px-1 text-xs ${live.error ? "text-red-300" : "text-amber-300"}`}
        role="alert"
        data-testid={live.error ? "live-voice-bar-error" : "live-voice-bar-attach-msg"}
      >
        {live.error || attachMsg}
      </p>
    ) : null;

  if (!inCall) {
    return (
      <div
        className="composer-bar is-fixed fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-5"
        data-testid="composer-bar"
        data-model-menu="closed"
        role="region"
        aria-label="Message composer"
        style={style}
      >
        <div className="composer-bar__safe mx-auto w-full max-w-3xl">
          <div className="composer-bar__card rounded-[1.75rem] border border-white/10 bg-[#111111] p-3 text-zinc-100 shadow-2xl">
            <form onSubmit={onAskSubmit}>
              <div className="composer-bar__ask mb-3" data-testid="composer-bar-ask">
                <input
                  data-testid="live-voice-bar-input"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="Ask Anything"
                  aria-label="Ask Anything"
                  className="composer-bar__ask-input h-10 w-full bg-transparent px-2 text-base text-zinc-100 outline-none placeholder:text-zinc-500"
                />
              </div>
              <div className="composer-bar__row flex items-center gap-2">
                <div className="composer-bar__left flex min-w-0 items-center gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      className="composer-bar__plus grid size-10 place-items-center rounded-full border border-white/10 bg-[#1c1c1e] text-lg text-zinc-100"
                      data-testid="composer-bar-plus"
                      aria-label="Add attachment"
                      aria-expanded={attachOpen}
                      onClick={() => {
                        setAttachOpen((v) => !v);
                        setAttachMsg(null);
                      }}
                    >
                      <Plus className="composer-bar__plus-glyph size-5" strokeWidth={2} aria-hidden="true" />
                    </button>
                    {plusMenu(false)}
                  </div>
                  <div className="composer-bar__model-wrap min-w-0">
                    <div
                      className="composer-bar__model inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full border border-white/10 bg-[#1c1c1e] px-3 py-2 text-xs font-medium"
                      data-testid="composer-bar-model"
                    >
                      {props.modelPickerSlot ?? <span className="composer-bar__model-label">Model</span>}
                    </div>
                  </div>
                </div>
                <div className="flex-1" />
                <div
                  className="composer-voice-btns flex items-center gap-2"
                  data-testid="composer-voice-buttons"
                  data-dictation={dictationState}
                  data-speak={uiAttr}
                  role="group"
                  aria-label="Voice input"
                >
                  <button
                    type="button"
                    className={`composer-mic-dictation composer-mic-dictate relative grid size-10 place-items-center rounded-full border ${
                      dictationState === "recording"
                        ? "border-red-400/60 bg-red-500/20 text-red-100"
                        : "border-white/10 bg-[#1c1c1e] text-zinc-100"
                    }`}
                    data-testid="composer-mic-dictate"
                    data-state={dictationState}
                    aria-label="Dictate"
                    aria-pressed={dictationState === "recording"}
                    onClick={onDictate}
                  >
                    <Mic className="composer-mic-dictation__glyph size-5" strokeWidth={2} aria-hidden="true" />
                    <span
                      className={`composer-mic-dictation__dot absolute top-1 right-1 size-2 rounded-full ${
                        dictationState === "recording" ? "bg-red-400" : "bg-transparent"
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    className="composer-speak-live composer-speak-pill inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black shadow-md"
                    data-testid="composer-speak"
                    data-live-voice={uiAttr}
                    data-state={uiAttr}
                    aria-label="Start voice conversation"
                    aria-pressed={false}
                    onClick={startSpeak}
                  >
                    <AudioLines className="composer-speak-live__bars size-4" strokeWidth={2.25} aria-hidden="true" />
                    <span className="composer-speak-live__label">Speak</span>
                  </button>
                </div>
              </div>
            </form>
            {statusLine}
          </div>
        </div>
        {fileInputs}
      </div>
    );
  }

  return (
    <div
      className="live-voice-bar live-voice-control fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-5"
      data-live-voice={uiAttr}
      data-state={uiAttr}
      data-testid="live-voice-bar"
      role="region"
      aria-label={`Live voice bar — ${live.label}`}
      style={style}
    >
      <div className="live-voice-bar__glass pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-3xl rounded-[1.75rem] border border-white/10 bg-[#0a0a0a]/95 p-3 text-zinc-100 shadow-2xl backdrop-blur">
        <p className="mb-2 px-1 text-[10px] font-semibold tracking-wide text-emerald-300" role="status">
          LIVE · {live.label}
        </p>
        <div className="live-voice-bar__controls live-call-grid mb-3 grid grid-cols-4 gap-2" role="group" aria-label="Live voice tools">
          <button type="button" className={PILL} data-testid="live-voice-bar-screen" aria-label="Screen share" aria-pressed={screenOn} onClick={onScreenClick}>
            <ScreenShare className="lvb-ico lvb-ico--screen size-6" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={PILL}
            data-testid="live-voice-bar-speaker"
            aria-label="Speaker"
            aria-pressed={live.speakerMuted}
            onClick={live.toggleSpeaker}
          >
            {live.speakerMuted ? (
              <VolumeX className="lvb-ico lvb-ico--speaker size-6" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Volume2 className="lvb-ico lvb-ico--speaker size-6" strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className={`${PILL} live-voice-bar__mic flex-col gap-1 ${muted ? "" : "border-violet-400/40 bg-violet-500/15"}`}
            data-testid="live-voice-bar-mute"
            aria-label={muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={muted}
            onClick={() => live.toggleMute()}
          >
            <span className="live-voice-bar__mic-ring" aria-hidden="true" />
            {muted ? (
              <MicOff className="lvb-ico lvb-ico--mic is-slashed size-6" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Mic className="lvb-ico lvb-ico--mic size-6" strokeWidth={1.75} aria-hidden="true" />
            )}
            <span className="live-voice-bar__mic-dot" aria-hidden="true" />
            <span className="live-voice-bar__mic-dots mt-0.5 flex gap-0.5" aria-hidden="true">
              <i className="size-1 rounded-full bg-current opacity-80" />
              <i className="size-1 rounded-full bg-current opacity-80" />
              <i className="size-1 rounded-full bg-current opacity-80" />
              <i className="size-1 rounded-full bg-current opacity-80" />
              <i className="size-1 rounded-full bg-current opacity-80" />
            </span>
          </button>
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              className={PILL}
              data-testid="live-voice-bar-settings"
              aria-label="Voice settings"
              aria-pressed={settingsOpen}
              onClick={() => {
                setSettingsOpen((v) => !v);
                setAttachOpen(false);
              }}
            >
              <Settings className="lvb-ico lvb-ico--settings size-6" strokeWidth={1.75} aria-hidden="true" />
            </button>
            {settingsPopover}
          </div>
        </div>

        <div className="live-voice-bar__composer flex items-center gap-2">
          <div className="live-voice-bar__plus-wrap relative shrink-0">
            <button
              type="button"
              className="live-voice-bar__plus grid size-10 place-items-center rounded-full bg-[#1c1c1e] text-lg"
              data-testid="live-voice-bar-plus"
              aria-label="Add attachment"
              aria-expanded={attachOpen}
              onClick={() => {
                setAttachOpen((v) => !v);
                setSettingsOpen(false);
                setAttachMsg(null);
              }}
            >
              <Plus className="lvb-ico lvb-ico--plus size-5" strokeWidth={2} aria-hidden="true" />
            </button>
            {plusMenu(true)}
          </div>
          <form className="live-voice-bar__ask min-w-0 flex-1" data-testid="live-voice-bar-input" onSubmit={onAskSubmit}>
            <input
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Ask Anything"
              aria-label="Ask Anything"
              className="live-voice-bar__ask-input h-11 w-full rounded-full border border-white/10 bg-[#1c1c1e] px-4 text-sm outline-none placeholder:text-zinc-500"
            />
          </form>
          <button
            type="button"
            className="live-voice-bar__end live-call-end grid h-12 w-24 shrink-0 place-items-center rounded-full bg-[#f26b6b] text-white shadow-[0_0_18px_rgb(242_107_107/0.45)]"
            data-testid="live-voice-bar-end"
            aria-label="End call"
            onClick={endEverything}
          >
            <Phone className="lvb-ico lvb-ico--hangup size-6 rotate-[135deg]" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {statusLine}
      </div>
      <span className="live-voice-bar__sr sr-only" role="status" aria-live="polite">
        {live.label}
      </span>
      {fileInputs}
    </div>
  );
}
