/**
 * Persistent Grok-style live-voice bottom bar.
 * Layout + colors live here (Tailwind). Do not edit styles.css (Visual Polish).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Plus,
  Settings,
  Video,
  Volume2,
  VolumeX,
  X,
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
  openCameraStream,
  openScreenStream,
  readTextFile,
  sampleVideoFrames,
  startMediaFrameStream,
  type FrameStreamHandle,
} from "./frame-capture";

export type LiveVoiceBarProps = {
  isOverlayMicOpen: () => boolean;
  stopOverlayMic: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  /** Normal chat send when Ask Anything fires while not live. */
  onChatSend?: (text: string) => void;
  /** Attach text context into normal chat when not live. */
  onChatAttachText?: (text: string, name: string) => void;
};

function LogoMark() {
  // Reuses the Adrians Mind sidebar mark (purple shield A) as a compact SVG.
  return (
    <span
      className="grid size-9 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500 text-sm font-bold text-white shadow-[0_0_14px_rgb(124_92_255/0.45)]"
      data-testid="live-voice-bar-logo"
      aria-hidden="true"
      title="Adrian's Mind"
    >
      A
    </span>
  );
}

function RoundBtn(props: {
  testId: string;
  label: string;
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      className={
        props.className ??
        "grid size-11 shrink-0 place-items-center rounded-full border border-white/10 bg-zinc-900 text-zinc-100 shadow-md transition hover:bg-zinc-800 disabled:opacity-50"
      }
    >
      {props.children}
    </button>
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

  const [ask, setAsk] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [voiceMode, setVoiceMode] = useState<VoiceRoutingMode>(() => getVoiceMode());
  const [voiceChoice, setVoiceChoice] = useState<XaiBuiltinVoice>(() =>
    readStoredVoiceChoice(typeof localStorage === "undefined" ? null : localStorage),
  );

  const cameraRef = useRef<FrameStreamHandle | null>(null);
  const screenRef = useRef<FrameStreamHandle | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    setCameraOn(false);
  }, []);

  const stopScreen = useCallback(() => {
    screenRef.current?.stop();
    screenRef.current = null;
    setScreenOn(false);
  }, []);

  const endEverything = useCallback(() => {
    stopCamera();
    stopScreen();
    live.end();
    setAttachOpen(false);
    setSettingsOpen(false);
  }, [live, stopCamera, stopScreen]);

  // Ctrl+Shift+V while live: end so two mics never open.
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

  // Stop media streams when session ends externally.
  useEffect(() => {
    if (!live.active) {
      stopCamera();
      stopScreen();
    }
  }, [live.active, stopCamera, stopScreen]);

  useEffect(() => {
    return () => {
      stopCamera();
      stopScreen();
    };
  }, [stopCamera, stopScreen]);

  const ensureLive = useCallback(async () => {
    if (live.active) return true;
    if (props.isOverlayMicOpen()) props.stopOverlayMic();
    live.pressMic();
    // pressMic is async start under the hood; give a brief wait for occupancy
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
    if (live.active) {
      const ok = live.sendText(text);
      if (ok) setAsk("");
      return;
    }
    props.onChatSend?.(text);
    setAsk("");
    props.onNotice?.("Sent via normal chat (live voice was off).");
  };

  const onMic = () => {
    if (!live.active && props.isOverlayMicOpen()) props.stopOverlayMic();
    live.pressMic();
  };

  const toggleCamera = async () => {
    if (cameraOn) {
      stopCamera();
      return;
    }
    const opened = await openCameraStream();
    if (!opened.ok) {
      setAttachMsg(opened.error);
      props.onError?.(opened.error);
      return;
    }
    if (!live.active) {
      props.onNotice?.("Starting live voice for camera frames…");
      await ensureLive();
    }
    const handle = await startMediaFrameStream(
      opened.stream,
      async (b64) => {
        // Continuous frames: text context only (no vision flood); native input_image unsupported.
        void b64;
        if (live.active) live.sendText("(Live camera frame received — describe if relevant.)");
      },
      SCREEN_FRAME_INTERVAL_MS,
    );
    cameraRef.current = handle;
    setCameraOn(true);
    opened.stream.getVideoTracks()[0]?.addEventListener("ended", () => stopCamera());
  };

  const toggleScreen = async () => {
    if (screenOn) {
      stopScreen();
      return;
    }
    const opened = await openScreenStream();
    if (!opened.ok) {
      setAttachMsg(opened.error);
      props.onError?.(opened.error);
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

  const muteAria = muteButtonAria(live.active, live.muted);
  const uiAttr = live.uiAttr || "off";
  const style = barRootStyle(live.level);

  return (
    <div
      className="live-voice-bar live-voice-control fixed inset-x-0 bottom-14 z-40 md:bottom-0 border-t border-white/10 bg-zinc-950/95 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-zinc-100 backdrop-blur-md md:px-5"
      data-live-voice={uiAttr}
      data-testid="live-voice-bar"
      style={style as CSSProperties}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <LogoMark />
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <VoiceModeBadge
              mode={voiceMode}
              listening={live.active && !live.muted}
              onToggle={() => {
                const next = setVoiceModeStore(toggleVoiceMode(voiceMode));
                setVoiceMode(next);
              }}
            />
            {live.active ? (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300" role="status">
                LIVE · {live.label}
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500" role="status">
                Live voice off
              </span>
            )}
          </div>
        </div>

        <div className="flex items-end gap-2 md:gap-3">
          <div className="relative">
            <RoundBtn
              testId="live-voice-bar-plus"
              label="Attach"
              pressed={attachOpen}
              onClick={() => {
                setAttachOpen((v) => !v);
                setSettingsOpen(false);
                setAttachMsg(null);
              }}
            >
              {attachOpen ? <X className="size-5" /> : <Plus className="size-5" />}
            </RoundBtn>
            {attachOpen ? (
              <div
                className="absolute bottom-14 left-0 z-50 min-w-[12rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
                role="menu"
                aria-label="Attach menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="live-voice-bar-attach-camera"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800"
                  onClick={() => void attachCameraSnap()}
                >
                  <Camera className="size-4" /> Camera
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="live-voice-bar-attach-photo"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <ImageIcon className="size-4" /> Photo
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="live-voice-bar-attach-video"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800"
                  onClick={() => videoInputRef.current?.click()}
                >
                  <Video className="size-4" /> Video
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="live-voice-bar-attach-files"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-zinc-800"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileText className="size-4" /> Files
                </button>
              </div>
            ) : null}
          </div>

          <form onSubmit={onAskSubmit} className="min-w-0 flex-1">
            <input
              data-testid="live-voice-bar-input"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="Ask Anything"
              aria-label="Ask Anything"
              className="h-11 w-full rounded-full border border-white/10 bg-zinc-900/80 px-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-violet-400/50"
            />
          </form>

          <div className="flex items-center gap-1.5 md:gap-2" role="group" aria-label="Live controls">
            <RoundBtn
              testId="live-voice-bar-camera"
              label="Camera"
              pressed={cameraOn}
              onClick={() => void toggleCamera()}
              className={`grid size-11 shrink-0 place-items-center rounded-full border shadow-md transition ${
                cameraOn
                  ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                  : "border-white/10 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              }`}
            >
              <Camera className="size-5" />
            </RoundBtn>
            <RoundBtn
              testId="live-voice-bar-screen"
              label="Share screen"
              pressed={screenOn}
              onClick={() => void toggleScreen()}
              className={`grid size-11 shrink-0 place-items-center rounded-full border shadow-md transition ${
                screenOn
                  ? "border-sky-400/50 bg-sky-500/20 text-sky-200"
                  : "border-white/10 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              }`}
            >
              <MonitorUp className="size-5" />
            </RoundBtn>
            <RoundBtn
              testId="live-voice-bar-mute"
              label={muteAria.label}
              pressed={muteAria.pressed}
              onClick={onMic}
              className={`grid size-11 shrink-0 place-items-center rounded-full border shadow-md transition ${
                live.active && !live.muted
                  ? "border-violet-400/60 bg-violet-500/25 text-violet-100"
                  : "border-white/10 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              }`}
            >
              {live.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
            </RoundBtn>
            <div className="relative">
              <RoundBtn
                testId="live-voice-bar-settings"
                label="Settings"
                pressed={settingsOpen}
                onClick={() => {
                  setSettingsOpen((v) => !v);
                  setAttachOpen(false);
                }}
              >
                <Settings className="size-5" />
              </RoundBtn>
              {settingsOpen ? (
                <div
                  ref={settingsRef}
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
                    listening={live.active && !live.muted}
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
                        writeStoredVoiceChoice(
                          v,
                          typeof localStorage === "undefined" ? null : localStorage,
                        );
                      }}
                      disabled={false}
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
              ) : null}
            </div>
          </div>

          <button
            type="button"
            data-testid="live-voice-bar-end"
            aria-label="End voice"
            onClick={endEverything}
            className="grid size-14 shrink-0 place-items-center rounded-full bg-red-600 text-white shadow-[0_0_20px_rgb(220_38_38/0.45)] transition hover:bg-red-500"
          >
            <PhoneOff className="size-6" />
          </button>
        </div>

        {attachMsg ? (
          <p className="text-xs text-amber-300" role="alert" data-testid="live-voice-bar-attach-msg">
            {attachMsg}
          </p>
        ) : null}
        {live.error ? (
          <p className="text-xs text-red-300" role="alert" data-testid="live-voice-bar-error">
            {live.error}
          </p>
        ) : null}
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handlePhotoFiles(e.target.files)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => void handleVideoFiles(e.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.csv,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.html,.css,.yml,.yaml,.toml,.xml,.log,text/*,application/json"
        className="hidden"
        onChange={(e) => void handleTextFiles(e.target.files)}
      />
    </div>
  );
}

