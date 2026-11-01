/**
 * Persistent Grok-style composer / live-call bar.
 * Idle: Ask Anything + attach + model chip + dictation mic + Speak pill.
 * Live: four control pills + (+ Ask Anything) + red hang-up.
 * Tailwind = layout + basic colors. Visual Polish skins via stable class hooks.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  AudioLines,
  Camera,
  FileText,
  Image as ImageIcon,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  Plus,
  Settings,
  Video,
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
import { barRootStyle, muteButtonAria } from "@/lib/mind/voice-live/bar-state";
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
import {
  captureCameraJpeg,
  fileToBase64,
  openScreenStream,
  readTextFile,
  sampleVideoFrames,
  startMediaFrameStream,
  type FrameStreamHandle,
} from "./frame-capture";
import { shouldCloseSettingsOnEscape } from "./settings-popover";

export type LiveVoiceBarProps = {
  isOverlayMicOpen: () => boolean;
  stopOverlayMic: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  onChatSend?: (text: string) => void;
  onChatAttachText?: (text: string, name: string) => void;
  /** Dictation (not a call): existing listen() path. */
  dictating?: boolean;
  onDictateToggle?: () => void;
  /** Sync Ask Anything with parent draft (dictation writes draft). */
  askValue?: string;
  onAskChange?: (value: string) => void;
  /** Logic-owned model chip — pass-through, do not rebuild. */
  modelPickerSlot?: ReactNode;
};

function AttachMenu(props: {
  open: boolean;
  onClose: () => void;
  onCamera: () => void;
  onPhoto: () => void;
  onVideo: () => void;
  onFiles: () => void;
}) {
  if (!props.open) return null;
  return (
    <div
      className="absolute bottom-12 left-0 z-50 min-w-[12rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
      role="menu"
      aria-label="Attach menu"
    >
      <button type="button" role="menuitem" data-testid="live-voice-bar-attach-camera" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800" onClick={props.onCamera}>
        <Camera className="size-4" /> Camera
      </button>
      <button type="button" role="menuitem" data-testid="live-voice-bar-attach-photo" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800" onClick={props.onPhoto}>
        <ImageIcon className="size-4" /> Photo
      </button>
      <button type="button" role="menuitem" data-testid="live-voice-bar-attach-video" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800" onClick={props.onVideo}>
        <Video className="size-4" /> Video
      </button>
      <button type="button" role="menuitem" data-testid="live-voice-bar-attach-files" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800" onClick={props.onFiles}>
        <FileText className="size-4" /> Files
      </button>
    </div>
  );
}

export function LiveVoiceBar(props: LiveVoiceBarProps) {
  const live = useLiveVoiceSession({
    isOverlayMicOpen: props.isOverlayMicOpen,
    onUserTranscript: props.onUserTranscript,
    onAssistantTranscript: props.onAssistantTranscript,
    onError: props.onError,
    onNotice: props.onNotice,
  });

  const inCall = live.active;
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
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const stopScreen = useCallback(() => {
    screenRef.current?.stop();
    screenRef.current = null;
    setScreenOn(false);
  }, []);

  const endEverything = useCallback(() => {
    stopScreen();
    live.end();
    setAttachOpen(false);
    setSettingsOpen(false);
  }, [live, stopScreen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesVoiceToggleShortcut(event)) return;
      if (!live.active && !isLiveVoiceOccupied()) return;
      event.preventDefault();
      event.stopPropagation();
      endEverything();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [live.active, endEverything]);

  useEffect(() => {
    if (!live.active) stopScreen();
  }, [live.active, stopScreen]);

  useEffect(() => () => stopScreen(), [stopScreen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!shouldCloseSettingsOnEscape(event.key, true)) return;
      event.preventDefault();
      event.stopPropagation();
      setSettingsOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      const root = settingsRef.current;
      const target = event.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      setSettingsOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer, true);
    };
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
      const wasLive = live.active;
      if (!wasLive) {
        props.onNotice?.(
          "Not live yet — starting live voice, then attaching via chat/vision fallback (realtime has no native input_image).",
        );
        await ensureLive();
      } else {
        props.onNotice?.(
          REALTIME_NATIVE_INPUT_IMAGE
            ? "Sending image into the live session."
            : "Realtime ignores input_image — using chat/vision fallback and speaking the reply on the same output.",
        );
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

      const prompt = [
        caption.trim() || "Describe this attached image briefly for the live conversation.",
        analysis ? `Vision summary: ${analysis}` : "",
      ]
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
      props.onNotice?.("Live voice is still connecting — sending via normal chat so your message is not lost.");
    }
    if (!props.onChatSend) {
      props.onError?.("Chat send is unavailable.");
      return;
    }
    props.onChatSend(text);
    setAsk("");
  };

  const startSpeak = () => {
    if (props.dictating) props.stopOverlayMic();
    if (props.isOverlayMicOpen()) props.stopOverlayMic();
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

  const toggleScreen = async () => {
    if (screenOn) {
      stopScreen();
      return;
    }
    const opened = await openScreenStream();
    if (!opened.ok) {
      const msg = opened.error || "Screen share was cancelled or isn't available.";
      setAttachMsg(msg);
      props.onError?.(msg);
      props.onNotice?.(msg);
      return;
    }
    if (!live.active) {
      props.onNotice?.("Starting live voice for screen share…");
      await ensureLive();
    }
    const handle = await startMediaFrameStream(
      opened.stream,
      async (b64) => {
        void b64;
        if (live.active) live.sendText("(Live screen frame received — describe if relevant.)");
      },
      SCREEN_FRAME_INTERVAL_MS,
    );
    screenRef.current = handle;
    setScreenOn(true);
    opened.stream.getVideoTracks()[0]?.addEventListener("ended", () => stopScreen());
  };

  const attachCameraSnap = async () => {
    setAttachOpen(false);
    const snap = await captureCameraJpeg();
    if (!snap.ok) {
      setAttachMsg(snap.error);
      props.onError?.(snap.error);
      return;
    }
    await pushVisionFallback(snap.base64, "Camera snapshot");
  };

  const handlePhotoFiles = async (files: FileList | null) => {
    setAttachOpen(false);
    const file = files?.[0];
    if (!file) return;
    const check = validateAttachment(file, "photo");
    if (!check.ok) {
      setAttachMsg(check.error);
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      await pushVisionFallback(b64, `Photo: ${file.name}`);
    } catch {
      setAttachMsg("Could not read that photo.");
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleVideoFiles = async (files: FileList | null) => {
    setAttachOpen(false);
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
    props.onNotice?.(`Sampled ${sampled.frames.length} video frame(s) (~1 fps, max ${MAX_VIDEO_FRAMES}).`);
    for (const frame of sampled.frames.slice(0, 3)) {
      await pushVisionFallback(frame, `Video frame from ${file.name}`);
    }
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const handleTextFiles = async (files: FileList | null) => {
    setAttachOpen(false);
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
      if (live.active) {
        live.sendText(payload);
        props.onNotice?.(`Attached ${file.name} into the live session as text context.`);
      } else {
        props.onChatAttachText?.(payload, file.name);
        props.onNotice?.(`Attached ${file.name} to normal chat (live was off).`);
      }
    } catch {
      setAttachMsg("Could not read that file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const muteAria = muteButtonAria(live.active, live.muted);
  const uiAttr = live.uiAttr || "off";
  const style = barRootStyle(live.level) as CSSProperties;
  const trulyListening =
    live.state.phase === "listening" ||
    live.state.phase === "user_speaking" ||
    live.state.phase === "thinking" ||
    live.state.phase === "assistant_speaking";

  const settingsPopover = settingsOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live voice settings"
      className="absolute right-0 bottom-14 z-50 w-72 rounded-2xl border border-white/10 bg-zinc-900 p-3 shadow-2xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setSettingsOpen(false);
        }
      }}
    >
      <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400">VOICE SETTINGS</p>
      <VoiceModeBadge
        mode={voiceMode}
        listening={trulyListening}
        onToggle={() => {
          const next = setVoiceModeStore(toggleVoiceMode(voiceMode));
          setVoiceMode(next);
        }}
      />
      <div className="mt-3">
        <p className="mb-1 text-xs text-zinc-400">Voice</p>
        <VoicePicker
          value={voiceChoice}
          onChange={(v) => {
            setVoiceChoice(v);
            writeStoredVoiceChoice(v, typeof localStorage === "undefined" ? null : localStorage);
          }}
          className="inline-flex w-full items-center gap-1 text-xs text-zinc-300"
        />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-xs text-zinc-400">Speaker</p>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-xs"
            aria-label={live.speakerMuted ? "Unmute output" : "Mute output"}
            aria-pressed={live.speakerMuted}
            onClick={live.toggleSpeaker}
          >
            {live.speakerMuted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            {live.speakerMuted ? "Muted" : "On"}
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={live.volume}
          aria-label="Output volume"
          onChange={(e) => live.setOutputVolume(Number(e.target.value))}
          className="w-full accent-violet-400"
        />
      </div>
    </div>
  ) : null;

  const hiddenFileInputs = (
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

  return (
    <div
      className="live-voice-bar live-voice-control fixed inset-x-0 bottom-14 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:bottom-0 md:px-5"
      data-live-voice={uiAttr}
      data-testid="live-voice-bar"
      style={style}
    >
      <div className="mx-auto w-full max-w-3xl">
        {!inCall ? (
          <div className="rounded-[1.75rem] border border-white/10 bg-zinc-900/95 p-3 text-zinc-100 shadow-2xl backdrop-blur-md">
            <form onSubmit={onAskSubmit}>
              <input
                data-testid="live-voice-bar-input"
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Ask Anything"
                aria-label="Ask Anything"
                className="mb-3 h-10 w-full bg-transparent px-2 text-base text-zinc-100 outline-none placeholder:text-zinc-500"
              />
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    data-testid="live-voice-bar-plus"
                    aria-label="Attach"
                    aria-pressed={attachOpen}
                    onClick={() => {
                      setAttachOpen((v) => !v);
                      setSettingsOpen(false);
                      setAttachMsg(null);
                    }}
                    className="grid size-10 place-items-center rounded-full border border-white/10 bg-zinc-800 text-zinc-100"
                  >
                    <Plus className="size-5" />
                  </button>
                  <AttachMenu
                    open={attachOpen}
                    onClose={() => setAttachOpen(false)}
                    onCamera={() => void attachCameraSnap()}
                    onPhoto={() => photoInputRef.current?.click()}
                    onVideo={() => videoInputRef.current?.click()}
                    onFiles={() => fileInputRef.current?.click()}
                  />
                </div>

                <div className="min-w-0 shrink">{props.modelPickerSlot ?? null}</div>

                <div className="flex-1" />

                <button
                  type="button"
                  data-testid="composer-mic-dictate"
                  aria-label={props.dictating ? "Stop dictation" : "Dictate"}
                  aria-pressed={Boolean(props.dictating)}
                  onClick={onDictate}
                  className={`composer-mic-dictate grid size-10 place-items-center rounded-full border shadow-md ${
                    props.dictating
                      ? "border-violet-400/60 bg-violet-500/25 text-violet-100"
                      : "border-white/10 bg-zinc-800 text-zinc-100"
                  }`}
                >
                  {props.dictating ? <MicOff className="size-5" /> : <Mic className="size-5" />}
                </button>

                <button
                  type="button"
                  data-testid="composer-speak"
                  aria-label="Speak"
                  onClick={startSpeak}
                  className="composer-speak-pill inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black shadow-md"
                >
                  <AudioLines className="size-4" aria-hidden="true" />
                  Speak
                </button>
              </div>
            </form>
            {live.error ? (
              <p className="mt-2 text-xs text-red-300" role="alert" data-testid="live-voice-bar-error">
                {live.error}
              </p>
            ) : null}
            {attachMsg ? (
              <p className="mt-2 text-xs text-amber-300" role="alert" data-testid="live-voice-bar-attach-msg">
                {attachMsg}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-white/10 bg-zinc-950/95 p-3 text-zinc-100 shadow-2xl backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300" role="status">
                LIVE · {live.label}
              </span>
              <VoiceModeBadge
                mode={voiceMode}
                listening={trulyListening}
                onToggle={() => {
                  const next = setVoiceModeStore(toggleVoiceMode(voiceMode));
                  setVoiceMode(next);
                }}
              />
            </div>

            <div className="live-call-grid mb-3 grid grid-cols-4 gap-2" role="group" aria-label="Live call controls">
              <button
                type="button"
                data-testid="live-voice-bar-screen"
                aria-label="Share screen"
                aria-pressed={screenOn}
                onClick={() => void toggleScreen()}
                className={`live-call-pill flex h-14 items-center justify-center rounded-2xl border ${
                  screenOn ? "border-sky-400/50 bg-sky-500/20" : "border-white/10 bg-zinc-900"
                }`}
              >
                <MonitorUp className="size-5" />
              </button>
              <button
                type="button"
                data-testid="live-voice-bar-speaker"
                aria-label={live.speakerMuted ? "Unmute output" : "Mute output"}
                aria-pressed={live.speakerMuted}
                onClick={live.toggleSpeaker}
                className={`live-call-pill flex h-14 items-center justify-center rounded-2xl border ${
                  live.speakerMuted ? "border-amber-400/40 bg-amber-500/15" : "border-white/10 bg-zinc-900"
                }`}
              >
                {live.speakerMuted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
              </button>
              <button
                type="button"
                data-testid="live-voice-bar-mute"
                aria-label={muteAria.label === "Start live voice" ? "Mute" : muteAria.label}
                aria-pressed={muteAria.pressed}
                onClick={() => live.toggleMute()}
                className={`live-call-pill flex h-14 flex-col items-center justify-center gap-1 rounded-2xl border ${
                  live.muted ? "border-white/20 bg-zinc-800" : "border-violet-400/50 bg-violet-500/20"
                }`}
              >
                {live.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
                <span className="flex gap-0.5" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <i
                      key={i}
                      className="inline-block size-1 rounded-full bg-current opacity-80"
                      style={{ opacity: 0.35 + live.level * 0.65 }}
                    />
                  ))}
                </span>
              </button>
              <div className="relative" ref={settingsRef}>
                <button
                  type="button"
                  data-testid="live-voice-bar-settings"
                  aria-label="Settings"
                  aria-pressed={settingsOpen}
                  onClick={() => {
                    setSettingsOpen((v) => !v);
                    setAttachOpen(false);
                  }}
                  className="live-call-pill flex h-14 w-full items-center justify-center rounded-2xl border border-white/10 bg-zinc-900"
                >
                  <Settings className="size-5" />
                </button>
                {settingsPopover}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <form onSubmit={onAskSubmit} className="relative flex min-w-0 flex-1 items-center rounded-full border border-white/10 bg-zinc-900 pl-1.5 pr-3">
                <div className="relative shrink-0">
                  <button
                    type="button"
                    data-testid="live-voice-bar-plus"
                    aria-label="Attach"
                    aria-pressed={attachOpen}
                    onClick={() => {
                      setAttachOpen((v) => !v);
                      setSettingsOpen(false);
                      setAttachMsg(null);
                    }}
                    className="grid size-9 place-items-center rounded-full bg-zinc-800 text-zinc-100"
                  >
                    <Plus className="size-4" />
                  </button>
                  <AttachMenu
                    open={attachOpen}
                    onClose={() => setAttachOpen(false)}
                    onCamera={() => void attachCameraSnap()}
                    onPhoto={() => photoInputRef.current?.click()}
                    onVideo={() => videoInputRef.current?.click()}
                    onFiles={() => fileInputRef.current?.click()}
                  />
                </div>
                <input
                  data-testid="live-voice-bar-input"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="Ask Anything"
                  aria-label="Ask Anything"
                  className="h-11 min-w-0 flex-1 bg-transparent px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                />
              </form>
              <button
                type="button"
                data-testid="live-voice-bar-end"
                aria-label="End voice"
                onClick={endEverything}
                className="live-call-end grid h-12 w-14 shrink-0 place-items-center rounded-full bg-red-600 text-white shadow-[0_0_20px_rgb(220_38_38/0.45)]"
              >
                <Phone className="size-5 rotate-[135deg]" />
              </button>
            </div>

            {attachMsg ? (
              <p className="mt-2 text-xs text-amber-300" role="alert" data-testid="live-voice-bar-attach-msg">
                {attachMsg}
              </p>
            ) : null}
            {live.error ? (
              <p className="mt-2 text-xs text-red-300" role="alert" data-testid="live-voice-bar-error">
                {live.error}
              </p>
            ) : null}
          </div>
        )}
      </div>
      {hiddenFileInputs}
    </div>
  );
}
