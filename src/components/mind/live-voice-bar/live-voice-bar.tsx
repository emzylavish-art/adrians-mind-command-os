/**
 * Wired Grok composer + live-call chrome.
 * DOM mirrors Visual Polish voice-ui (pass 10c/d) so styles.css skins apply after merge.
 * Do not edit styles.css. Tailwind kept to layout/safety only where VP CSS is absent.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { analyzeImageFile } from "@/lib/mind/server";
import { useLiveVoiceSession } from "@/lib/mind/voice-live/use-live-voice-session";
import type { VoiceProfileInput } from "@/lib/mind/voice-live/session-instructions";
import { isLiveVoiceOccupied } from "@/lib/mind/voice-live/occupancy";
import {
  MAX_TEXT_FILE_CHARS,
  MAX_VIDEO_FRAMES,
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
  openScreenStream,
  readTextFile,
  sampleVideoFrames,
} from "./frame-capture";
import { shouldCloseSettingsOnEscape } from "./settings-popover";
import "./mobile-nav-clearance.css";

export type LiveVoiceBarProps = {
  isOverlayMicOpen: () => boolean;
  stopOverlayMic: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  onChatSend?: (text: string) => void;
  onChatAttachText?: (text: string, name: string) => void;
  getVoiceProfile?: () => Pick<VoiceProfileInput, "personalityId" | "customPersonality" | "characterId"> | null;
  onChatAttachImage?: (image: { dataUrl: string; name: string; mime: string }) => void;
  dictating?: boolean;
  onDictateToggle?: () => void;
  askValue?: string;
  onAskChange?: (value: string) => void;
  /** Existing model picker (Logic-owned) — wrapped in .composer-bar__model. */
  modelPickerSlot?: ReactNode;
  compactIdle?: boolean;
  authReady?: boolean;
  authSignedIn?: boolean;
  onSignInRequired?: () => void;
  onCompactSpeak?: () => void;
};

function speakAttr(ui: LiveVoiceUiAttr): LiveVoiceUiAttr {
  return ui || "off";
}

export function LiveVoiceBar(props: LiveVoiceBarProps) {
  const live = useLiveVoiceSession({
    isOverlayMicOpen: props.isOverlayMicOpen,
    onUserTranscript: props.onUserTranscript,
    onAssistantTranscript: props.onAssistantTranscript,
    onError: props.onError,
    onNotice: props.onNotice,
    getVoiceProfile: props.getVoiceProfile,
  });

  const inCall = live.active;
  const uiAttr = speakAttr(live.uiAttr || "off");
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
  const [voiceMode, setVoiceMode] = useState<VoiceRoutingMode>(() => getVoiceMode());
  const [voiceChoice, setVoiceChoice] = useState<XaiBuiltinVoice>(() =>
    readStoredVoiceChoice(typeof localStorage === "undefined" ? null : localStorage),
  );
  useEffect(() => {
    const sync = () => setVoiceChoice(readStoredVoiceChoice(typeof localStorage === "undefined" ? null : localStorage));
    window.addEventListener("amcos-character", sync);
    return () => window.removeEventListener("amcos-character", sync);
  }, []);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const stopScreen = useCallback(() => {}, []);

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

  const pushVisionFallback = useCallback(async (jpegBase64: string, caption: string, name = "live-attach.jpg") => {
    if (live.active) {
      const text = [caption.trim(), "(image was not sent through the realtime channel; attach it in Chat after the call.)"].filter(Boolean).join(" ");
      live.sendText(text);
      props.onNotice?.("The image itself is not available to realtime voice. Attach it in Chat to analyze it.");
      return;
    }
    if (!props.onChatAttachImage) {
      props.onNotice?.("Image attachment could not be staged. Nothing was sent.");
      return;
    }
    const dataUrl = jpegBase64.startsWith("data:") ? jpegBase64 : `data:image/jpeg;base64,${jpegBase64}`;
    props.onChatAttachImage({ dataUrl, name, mime: "image/jpeg" });
    props.onNotice?.("Image attached to the Chat composer. Press Send to analyze it.");
  }, [live, props]);

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
    if (props.authSignedIn === false) { props.onSignInRequired?.(); return; }
    if (!props.authReady) { props.onSignInRequired?.(); return; }
    if (props.dictating) props.stopOverlayMic();
    if (props.isOverlayMicOpen()) props.stopOverlayMic();
    if (live.state.phase === "connecting" || live.state.phase === "reconnecting") {
      live.pressMic();
      return;
    }
    if (!live.active) {
      if (props.isOverlayMicOpen()) props.stopOverlayMic();
      live.pressMic();
    }
  };

  const onDictate = () => {
    if (live.active) {
      props.onNotice?.("End the live call before using dictation.");
      return;
    }
    props.onDictateToggle?.();
  };

  const toggleScreen = async () => {
    if (!props.authReady) { props.onSignInRequired?.(); return; }
    setAttachMsg("Screen sharing is not enabled in this preview. Nothing was captured.");
    props.onNotice?.("Screen sharing is not enabled in this preview.");

  };

  const onPlusItem = async (id: "camera" | "photo" | "video" | "files") => {
    if (!props.authReady) { props.onSignInRequired?.(); return; }
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
    else fileInputRef.current?.click();
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
      await pushVisionFallback(await fileToBase64(file), `Photo: ${file.name}`, file.name);
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
    props.onNotice?.(`Sampled ${sampled.frames.length} video frame(s).`);
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

  useLayoutEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(max-width: 767.98px)");
    const apply = () => {
      if (!mq.matches) {
        root.style.removeProperty("--spv-f1-clearance");
        return;
      }
      const nav = document.querySelector('nav[aria-label="Primary"]');
      if (!nav) return;
      const plus = nav.querySelector('button[aria-label="New chat"]');
      const navTop = nav.getBoundingClientRect().top;
      const plusTop = plus?.getBoundingClientRect().top ?? navTop;
      const obstruct = Math.min(navTop, plusTop);
      const px = Math.max(0, Math.ceil(window.innerHeight - obstruct + 8));
      root.style.setProperty("--spv-f1-clearance", `${px}px`);
    };
    apply();
    const nav = document.querySelector('nav[aria-label="Primary"]');
    const ro = new ResizeObserver(apply);
    if (nav) ro.observe(nav);
    const plus = nav?.querySelector('button[aria-label="New chat"]');
    if (plus) ro.observe(plus);
    window.addEventListener("resize", apply);
    mq.addEventListener("change", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      mq.removeEventListener("change", apply);
      root.style.removeProperty("--spv-f1-clearance");
    };
  }, []);

  const style = barRootStyle(live.level) as CSSProperties;
  const muted = live.muted || uiAttr === "muted";

  const settingsPopover = settingsOpen ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live voice settings"
      className="absolute right-0 bottom-16 z-50 w-72 rounded-2xl border border-white/10 bg-zinc-900 p-3 shadow-2xl"
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

  if (!inCall && props.compactIdle) {
    return <div className="live-voice-compact-entry" data-testid="live-voice-compact-entry"><button type="button" onClick={props.onCompactSpeak} className="live-voice-compact-entry__button inline-flex items-center gap-2"><img src="/brand/marks/speak.png" alt="" width={18} height={18} className="size-4 rounded" />Speak</button></div>;
  }

  if (!inCall) {
    return (
      <div
        className="composer-bar is-fixed composer-bar--clear-nav"
        data-testid="composer-bar"
        data-model-menu="closed"
        role="region"
        aria-label="Message composer"
        style={style}
      >
        <div className="composer-bar__safe">
          <div className="composer-bar__card">
            <form onSubmit={onAskSubmit}>
              <div className="composer-bar__ask" data-testid="composer-bar-ask">
                <input
                  data-testid="live-voice-bar-input"
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="Ask Anything"
                  aria-label="Ask Anything"
                  className="composer-bar__ask-input w-full bg-transparent outline-none"
                />
              </div>

              <div className="composer-bar__row">
                <div className="composer-bar__left">
                  <div className="relative">
                    <button
                      type="button"
                      className="composer-bar__plus"
                      data-testid="composer-bar-plus"
                      aria-label="Add attachment"
                      aria-expanded={attachOpen}
                      onClick={() => {
                        setAttachOpen((v) => !v);
                        setAttachMsg(null);
                      }}
                    >
                      <span className="composer-bar__plus-glyph" aria-hidden="true" />
                    </button>
                    {attachOpen ? (
                      <ul className="live-voice-bar__plus-menu absolute bottom-12 left-0 z-50 min-w-[12rem] rounded-2xl border border-white/10 bg-zinc-900 p-1 shadow-2xl" role="menu" aria-label="Add media">
                        {(["camera", "photo", "video", "files"] as const).map((id) => (
                          <li key={id} role="none">
                            <button
                              type="button"
                              role="menuitem"
                              className="live-voice-bar__plus-item flex w-full px-3 py-2 text-left text-sm"
                              data-testid={`live-voice-bar-attach-${id}`}
                              onClick={() => void onPlusItem(id)}
                            >
                              <span className={`lvb-ico lvb-ico--${id}`} aria-hidden="true" />
                              {id[0]!.toUpperCase() + id.slice(1)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="composer-bar__model-wrap">
                    <div className="composer-bar__model" data-testid="composer-bar-model">
                      {props.modelPickerSlot ?? (
                        <span className="composer-bar__model-label">Model</span>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className="composer-voice-btns"
                  data-testid="composer-voice-buttons"
                  data-dictation={dictationState}
                  data-speak={uiAttr}
                  role="group"
                  aria-label="Voice input"
                >
                  <button
                    type="button"
                    className="composer-mic-dictation composer-mic-dictate"
                    data-testid="composer-mic-dictate"
                    data-state={dictationState}
                    aria-label="Dictate"
                    aria-pressed={dictationState === "recording"}
                    onClick={onDictate}
                  >
                    <span className="composer-mic-dictation__glyph" aria-hidden="true" />
                    <span className="composer-mic-dictation__dot" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    className="composer-speak-live composer-speak-pill"
                    data-testid="composer-speak"
                    data-live-voice={uiAttr}
                    data-state={uiAttr}
                    aria-label="Start voice conversation"
                    aria-pressed={false}
                    onClick={startSpeak}
                  >
                    <span className="composer-speak-live__bars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="composer-speak-live__label">Speak</span>
                  </button>
                </div>
              </div>
            </form>
            {live.error ? (
              <p className="mt-2 px-2 text-xs text-red-300" role="alert" data-testid="live-voice-bar-error">
                {live.error}
              </p>
            ) : null}
            {attachMsg ? (
              <p className="mt-2 px-2 text-xs text-amber-300" role="alert" data-testid="live-voice-bar-attach-msg">
                {attachMsg}
              </p>
            ) : null}
          </div>
        </div>
        {fileInputs}
      </div>
    );
  }

  return (
    <div
      className="live-voice-bar live-voice-control"
      data-live-voice={uiAttr}
      data-state={uiAttr}
      data-testid="live-voice-bar"
      role="region"
      aria-label={`Live voice bar — ${live.label}`}
      style={style}
    >
      <div className="live-voice-bar__glass" aria-hidden="true" />

      <div className="live-voice-bar__controls live-call-grid" role="group" aria-label="Live voice tools">
        <button
          type="button"
          className="live-voice-bar__round live-call-pill"
          data-testid="live-voice-bar-screen"
          aria-label="Screen share"
          aria-pressed={false}
          onClick={() => void toggleScreen()}
        >
          <span className="lvb-ico lvb-ico--screen" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="live-voice-bar__round live-call-pill"
          data-testid="live-voice-bar-speaker"
          aria-label="Speaker"
          aria-pressed={live.speakerMuted}
          onClick={live.toggleSpeaker}
        >
          <span className="lvb-ico lvb-ico--speaker" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="live-voice-bar__round live-voice-bar__mic live-call-pill"
          data-testid="live-voice-bar-mute"
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          onClick={() => live.toggleMute()}
        >
          <span className="live-voice-bar__mic-ring" aria-hidden="true" />
          <span className={`lvb-ico lvb-ico--mic${muted ? " is-slashed" : ""}`} aria-hidden="true" />
          <span className="live-voice-bar__mic-dot" aria-hidden="true" />
          <span className="live-voice-bar__mic-dots" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            className="live-voice-bar__round live-call-pill"
            data-testid="live-voice-bar-settings"
            aria-label="Voice settings"
            aria-pressed={settingsOpen}
            onClick={() => {
              setSettingsOpen((v) => !v);
              setAttachOpen(false);
            }}
          >
            <span className="lvb-ico lvb-ico--settings" aria-hidden="true" />
          </button>
          {settingsPopover}
        </div>
      </div>

      <div className="live-voice-bar__composer">
        <div className="live-voice-bar__plus-wrap">
          <button
            type="button"
            className="live-voice-bar__plus"
            data-testid="live-voice-bar-plus"
            aria-label="Add attachment"
            aria-expanded={attachOpen}
            onClick={() => {
              setAttachOpen((v) => !v);
              setSettingsOpen(false);
              setAttachMsg(null);
            }}
          >
            <span className="lvb-ico lvb-ico--plus" aria-hidden="true" />
          </button>
          {attachOpen ? (
            <ul className="live-voice-bar__plus-menu" role="menu" aria-label="Add media">
              {(["camera", "photo", "video", "files"] as const).map((id) => (
                <li key={id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="live-voice-bar__plus-item"
                    data-testid={`live-voice-bar-attach-${id}`}
                    onClick={() => void onPlusItem(id)}
                  >
                    <span className={`lvb-ico lvb-ico--${id}`} aria-hidden="true" />
                    {id[0]!.toUpperCase() + id.slice(1)}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <form className="live-voice-bar__ask" data-testid="live-voice-bar-input" onSubmit={onAskSubmit}>
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask Anything"
            aria-label="Ask Anything"
            className="live-voice-bar__ask-input w-full bg-transparent outline-none"
          />
        </form>

        <button
          type="button"
          className="live-voice-bar__end live-call-end"
          data-testid="live-voice-bar-end"
          aria-label="End call"
          onClick={endEverything}
        >
          <span className="lvb-ico lvb-ico--hangup" aria-hidden="true" />
        </button>
      </div>

      <span className="live-voice-bar__sr" role="status" aria-live="polite">
        {live.label}
      </span>
      {attachMsg ? (
        <p className="px-3 text-xs text-amber-300" role="alert" data-testid="live-voice-bar-attach-msg">
          {attachMsg}
        </p>
      ) : null}
      {live.error ? (
        <p className="px-3 text-xs text-red-300" role="alert" data-testid="live-voice-bar-error">
          {live.error}
        </p>
      ) : null}
      {fileInputs}
    </div>
  );
}
