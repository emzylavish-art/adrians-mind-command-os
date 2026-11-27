import { useAccountPreferences } from "./account-preferences-context";
import { useEffect, useRef, useState } from "react";
import { captureComposedSpeech, playComposedSpeech } from "@/lib/mind/voice/composed-browser";
import { runComposedVoiceTurn, type VoiceAnswer, type VoiceStageReceipt } from "@/lib/mind/voice/composed-turn";
import { DEFAULT_VOICE_ROUTE, readVoiceRoutePreferences, writeVoiceRoutePreferences, speechEngineLabel, type VoiceRoutePreferences, type SpeechEngine } from "@/lib/mind/voice/route-preferences";
import { loadVoiceSettings, saveVoiceSettings } from "@/lib/mind/voice/settings";
import { createPortal } from "react-dom";
import { ArrowUp, AudioLines, Camera, Mic, MicOff, MonitorUp, PhoneOff, Plus, Settings, Volume2, VolumeX, X } from "lucide-react";
import { canvasJpeg, openCameraStream, openScreenStream } from "@/components/mind/live-voice-bar/frame-capture";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
import type { SpeakSelection, SpeakStageReceipt } from "@/lib/mind/voice/staged-pipeline";
import {
  readStoredVoiceChoice,
  voiceDisplayName,
  writeStoredVoiceChoice,
  type XaiBuiltinVoice,
} from "@/lib/mind/voice/voices";

const VOICES: { id: XaiBuiltinVoice; line: string }[] = [
  { id: "ara", line: "Upbeat and bright." },
  { id: "eve", line: "Warm and engaging." },
  { id: "leo", line: "Confident and clear." },
  { id: "rex", line: "Calm and steady." },
  { id: "sal", line: "Friendly and smooth." },
  { id: "aurora", line: "Serene and steady." },
];

const RATES = [
  { id: "slow", label: "Slow" },
  { id: "natural", label: "Natural" },
  { id: "brisk", label: "Brisk" },
] as const;

const STYLES = ["Storyteller", "Supportive", "Playful", "Calm", "Unhinged"] as const;
const ACTIVATION = [
  { id: "default", label: "Default" },
  { id: "isolation", label: "Voice isolation" },
  { id: "push", label: "Push to talk" },
] as const;

type RateId = (typeof RATES)[number]["id"];
type StyleId = (typeof STYLES)[number];
type ActivationId = (typeof ACTIVATION)[number]["id"];

/**
 * Full-screen Speak, matched to the dark Grok voice screen:
 * voice list, waveform, mic, camera, screen share, and upload.
 * Camera, screen, and files stay on this device until a signed-in call is connected.
 */
export function SpeakStage(props: {
  open: boolean;
  signedIn: boolean;
  freeOnly?: boolean;
  live?: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onLive: () => Promise<void>;
  onSelectedSpeak?: () => Promise<void>;
  selectedBusy?: boolean;
  selectedRoute?: string;
  onStopSelected?: () => void;
  onOutputSettings?: (muted: boolean, volume: number) => void;
  onVoice: (voice: XaiBuiltinVoice) => void;
  micMuted: boolean;
  onMicMute: (muted: boolean) => void;
  recording: boolean;
  onAsk?: (text: string, playback: { canSpeak: () => boolean }) => Promise<string | null | { reply?: string; error?: string; speech?: "played" | "muted" }>;
  attachments?: { name: string }[];
  onAttachImage?: (file: File) => Promise<{ ok: true; name: string } | { ok: false; error: string }>;
  onRemoveAttachment?: (index: number) => void;
  onKeepRecording?: (stream: MediaStream) => void;
  onEmergencyStop?: () => void;
  halted?: boolean;
  onClearStop?: () => void;
  onHandCode?: (text: string) => void;
  onStyle?: (style: string) => void;
  heard?: string;
  spoken?: string;
  answerReceipt?: string;
  callError?: string;
}) {
  const preferenceStorage = useAccountPreferences();
  const dialogRef = useRef<HTMLDivElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettingsButton = useRef<HTMLButtonElement>(null);
  const callGeneration = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openRef = useRef(props.open);
  openRef.current = props.open;
  const mediaGeneration = useRef(0);
  const held = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef(props.onKeepRecording);
  keepRef.current = props.onKeepRecording;
  const [source, setSource] = useState<"none" | "camera" | "screen">("none");
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState("");
  const [voice, setVoice] = useState<XaiBuiltinVoice>("eve");
  const [rate, setRate] = useState<RateId>("natural");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const speakerMutedRef = useRef(false);
  speakerMutedRef.current = speakerMuted;
  const outputGeneration = useRef(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [style, setStyle] = useState<StyleId>("Storyteller");
  const [activation, setActivation] = useState<ActivationId>("default");
  const [volume, setVolume] = useState(100);
  const [recordingPending, setRecordingPending] = useState(false);
  const speechCutRef = useRef(false);
  const cutSpeechRef = useRef<(reason: "owner" | "tab") => void>(() => undefined);

  function cutSpeech(reason: "owner" | "tab") {
    speechCutRef.current = true;
    callGeneration.current++;
    mediaGeneration.current++;
    stopVideo();
    sharedAudioOutput.interrupt();
    props.onStopSelected?.();
    window.speechSynthesis?.cancel();
    setReply("");
    setConnecting(false);
    const message = reason === "tab"
      ? "Speech cut. The tab is closing."
      : "Speech cut. Emergency stop is on. Press Clear stop to release it.";
    setNotice(message);
    if (reason === "owner") props.onEmergencyStop?.();
  }
  cutSpeechRef.current = cutSpeech;

  function clearStop() {
    speechCutRef.current = false;
    setReply("");
    setNotice(null);
    props.onClearStop?.();
  }

  useEffect(() => {
    if (!props.open) return;
    const cut = () => cutSpeechRef.current("tab");
    window.addEventListener("pagehide", cut);
    window.addEventListener("beforeunload", cut);
    return () => {
      window.removeEventListener("pagehide", cut);
      window.removeEventListener("beforeunload", cut);
    };
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    setVoice(readStoredVoiceChoice(preferenceStorage));
    const saved = preferenceStorage.getItem("adrian-speak-rate");
    if (saved === "slow" || saved === "natural" || saved === "brisk") setRate(saved);
    const savedStyle = preferenceStorage.getItem("adrian-speak-style");
    if (savedStyle === "Storyteller" || savedStyle === "Supportive" || savedStyle === "Playful" || savedStyle === "Calm" || savedStyle === "Unhinged") setStyle(savedStyle);
    const savedVolume = Number(preferenceStorage.getItem("adrian-speak-volume") ?? "100");
    if (Number.isFinite(savedVolume)) setVolume(Math.min(100, Math.max(0, savedVolume)));
    const savedActivation = loadVoiceSettings(preferenceStorage).activation;
    setActivation(savedActivation === "push_to_talk" ? "push" : savedActivation);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    props.onOutputSettings?.(speakerMuted, volume / 100);
    sharedAudioOutput.setOutputVolume(speakerMuted ? 0 : volume / 100);
    sharedAudioOutput.setPcmRate(rate === "slow" ? 0.85 : rate === "brisk" ? 1.15 : 1);
    return () => {
      sharedAudioOutput.setOutputVolume(1);
      sharedAudioOutput.setPcmRate(1);
    };
  }, [props.open, speakerMuted, volume, rate]);

  function stopVideo() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSource("none");
  }

  useEffect(() => {
    if (!props.open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add("eve-call-open");
    dialogRef.current?.focus();
    return () => {
      callGeneration.current++;
      mediaGeneration.current++;
      held.current = false;
      stopVideo();
      setSettingsOpen(false);
      setConnecting(false);
      setAsking(false);
      setRecordingPending(false);
      setReply("");
      setNotice(null);
      setSpeakerMuted(false);
      speakerMutedRef.current = false;
      outputGeneration.current++;
      props.onStopSelected?.();
      document.documentElement.classList.remove("eve-call-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [props.open]);

  useEffect(() => {
    if (settingsOpen) closeSettingsButton.current?.focus();
  }, [settingsOpen]);

  function closeSettings() {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

  async function show(next: "camera" | "screen") {
    if (source === next) {
      stopVideo();
      setNotice(null);
      return;
    }
    stopVideo();
    const generation = ++mediaGeneration.current;
    const opened = next === "camera" ? await openCameraStream() : await openScreenStream();
    if (generation !== mediaGeneration.current || !openRef.current) {
      if (opened.ok) opened.stream.getTracks().forEach((track) => track.stop());
      return;
    }
    if (!opened.ok) {
      setNotice(opened.error);
      return;
    }
    streamRef.current = opened.stream;
    opened.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (streamRef.current !== opened.stream) return;
      stopVideo();
      setNotice(next === "screen" ? "Screen share ended." : "Camera ended.");
    });
    if (videoRef.current) {
      videoRef.current.srcObject = opened.stream;
      await videoRef.current.play().catch(() => undefined);
    }
    if (streamRef.current !== opened.stream) return;
    setSource(next);
    setNotice("Preview is on. Attach a frame to include it in your next turn.");
  }

  async function attachFrame() {
    if (!props.onAttachImage || !videoRef.current || !streamRef.current || props.halted) return;
    const generation = mediaGeneration.current;
    try {
      const jpeg = canvasJpeg(videoRef.current);
      if (!jpeg) { setNotice("Waiting for the first frame. Try again in a moment."); return; }
      const bytes = Uint8Array.from(atob(jpeg), char => char.charCodeAt(0));
      const result = await props.onAttachImage(new File([bytes], `${source}-${Date.now()}.jpg`, { type: "image/jpeg" }));
      if (generation === mediaGeneration.current && openRef.current) setNotice(result.ok ? "Frame attached to your next turn." : result.error);
    } catch {
      if (generation === mediaGeneration.current && openRef.current) setNotice("The frame could not be attached. Try again.");
    }
  }

  async function startLive() {
    if (props.freeOnly) { setNotice("Free-only mode keeps xAI realtime voice off."); return; }
    if (!props.signedIn) { props.onSignIn(); return; }
    if (props.halted || connecting || props.live) return;
    const generation = callGeneration.current;
    setNotice(null);
    setConnecting(true);
    try {
      await sharedAudioOutput.preparePlayback();
      if (generation === callGeneration.current && openRef.current && !speechCutRef.current) await props.onLive();
    } catch {
      if (openRef.current) setNotice("Audio output could not start. Enable sound and try again.");
    } finally {
      if (openRef.current && generation === callGeneration.current) setConnecting(false);
    }
  }

  async function startRecording() {
    if (recordingPending || props.recording || props.live || connecting || props.halted) return;
    const generation = mediaGeneration.current;
    setRecordingPending(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!openRef.current || generation !== mediaGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      keepRef.current?.(stream);
      props.onClose();
    } catch {
      if (openRef.current) setNotice("The microphone could not be opened for recording.");
    } finally {
      if (openRef.current) setRecordingPending(false);
    }
  }

  function chooseVoice(next: XaiBuiltinVoice) {
    const stored = writeStoredVoiceChoice(next, preferenceStorage);
    setVoice(stored);
    props.onVoice(stored);
    setNotice(`${voiceDisplayName(stored)} is selected for xAI speech. OpenAI output uses its own Alloy voice.`);
  }

  function chooseRate(next: RateId) {
    setRate(next);
    try {
      preferenceStorage.setItem("adrian-speak-rate", next);
      saveVoiceSettings(preferenceStorage, { ...loadVoiceSettings(preferenceStorage), speed: next === "natural" ? "normal" : next === "brisk" ? "fast" : "slow" });
    } catch {
      /* private mode */
    }
    setNotice(`${next} pace is saved.`);
  }

  function chooseStyle(next: StyleId) {
    setStyle(next);
    try { preferenceStorage.setItem("adrian-speak-style", next); } catch { /* private mode */ }
    props.onStyle?.(next);
    setNotice(`${next} is saved for this call.`);
  }

  function chooseVolume(next: number) {
    const level = Math.min(100, Math.max(0, next));
    setVolume(level);
    props.onOutputSettings?.(speakerMutedRef.current, level / 100);
    try { preferenceStorage.setItem("adrian-speak-volume", String(level)); } catch { /* private mode */ }
    setNotice(level === 0 ? "Speaker volume is off." : `Speaker volume is ${level}.`);
  }

  function chooseActivation(next: ActivationId) {
    setActivation(next);
    if (props.live) props.onMicMute(next === "push");
    saveVoiceSettings(preferenceStorage, { ...loadVoiceSettings(preferenceStorage), activation: next === "push" ? "push_to_talk" : next });
    setNotice(next === "push" ? "Push to talk is saved. Hold the microphone to talk." : next === "isolation" ? "Voice isolation is saved for the next microphone open." : "Default voice activation is saved.");
  }

  function toggleSpeaker() {
    const next = !speakerMuted;
    speakerMutedRef.current = next;
    if (next) outputGeneration.current++;
    setSpeakerMuted(next);
    props.onOutputSettings?.(next, volume / 100);
    if (next && !props.onOutputSettings) props.onStopSelected?.();
    if (next) window.speechSynthesis?.cancel();
    setNotice(next ? "Speaker muted for this call." : "Speaker on.");
  }

  async function ask() {
    const text = line.trim() || (props.attachments?.length ? "Describe the attached image." : "");
    if (!text || !props.onAsk || asking || props.halted) return;
    if (!props.signedIn) { props.onSignIn(); return; }
    const generation = callGeneration.current, output = outputGeneration.current;
    const isCurrent = () => openRef.current && generation === callGeneration.current && !speechCutRef.current;
    const canSpeak = () => isCurrent() && output === outputGeneration.current && !speakerMutedRef.current;
    setAsking(true);
    setShowTranscript(true);
    setReply("");
    setNotice(speakerMutedRef.current ? "Adrian is answering. The reply will remain written while the speaker is muted." : "Adrian is answering. The reply will be spoken.");
    try {
      const result = await props.onAsk(text, { canSpeak });
      if (!isCurrent()) return;
      if (result && typeof result === "object") {
        setReply(result.reply ?? "");
        setNotice(result.error ?? (result.speech === "muted" ? "Reply saved. Speaker muted." : result.reply ? "Spoken." : "The reply did not include text."));
        if (!result.error) setLine("");
      } else {
        setReply("");
        setNotice(result ?? "Spoken.");
        if (!result) setLine("");
      }
    } catch {
      if (!isCurrent()) return;
      setReply("");
      setNotice("The reply did not finish. Nothing was spoken.");
    } finally {
      if (isCurrent()) setAsking(false);
    }
  }

  if (!props.open) return null;
  const status = props.halted ? "Emergency stop is on" : props.callError ? "Voice unavailable" : props.live ? (props.micMuted ? "Microphone muted" : "Live conversation") : connecting ? "Connecting…" : "Ready to start";
  const attachedNames = props.attachments?.map((item) => item.name) ?? [];
  const transcript = [props.heard && `You: ${props.heard}`, (reply || props.spoken) && `Adrian: ${reply || props.spoken}`, attachedNames.length ? `Attached: ${attachedNames.join(", ")}` : null].filter(Boolean).join("\n");

  const stage = (
    <div ref={dialogRef} tabIndex={-1} className="speak-stage speak-call" role="dialog" aria-modal="true" aria-label="Speak" data-testid="speak-stage"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (settingsOpen) closeSettings();
          else props.onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const root = settingsOpen ? dialogRef.current?.querySelector(".speak-sheet") : dialogRef.current;
        const controls = root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([hidden]):not([disabled])');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
    >
      <video ref={videoRef} className={source === "none" ? "is-hidden" : source} playsInline muted autoPlay />
      <div className="speak-call__top">
        <span>Adrian’s Mind <span className="speak-call__provider">/ {props.freeOnly ? "Free-only · cloud voice off" : props.live ? "xAI realtime" : "Selected speech providers"}</span></span>
        <div className="speak-call__safety">
          <button type="button" data-testid="speak-emergency-stop" onClick={() => cutSpeechRef.current("owner")}>Emergency stop</button>
          {props.halted && <button type="button" data-testid="speak-clear-stop" onClick={clearStop}>Clear stop</button>}
        </div>
      </div>
      <section className="speak-system" data-testid="speak-system">
        <div className="speak-call__symbol" aria-hidden="true"><AudioLines /></div>
        <h2>Speak with Adrian</h2>
        <p role="status" data-testid="speak-status">{status}</p>
        {!props.live && props.onSelectedSpeak && <button type="button" className="speak-call__place" disabled={props.freeOnly || props.halted || connecting || recordingPending || props.recording || speakerMuted} onClick={() => { if (!props.signedIn) props.onSignIn(); else if (props.selectedBusy) props.onStopSelected?.(); else void props.onSelectedSpeak?.(); }}>{props.selectedBusy ? "Stop selected voice turn" : "Speak with chat model"}</button>}
        {!props.live && props.selectedRoute && <p className="speak-call__transcript">{props.selectedRoute}. One recorded turn uses these selected stages. Playback and transcription are reported separately.</p>}
        {!props.live && <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={props.halted || props.selectedBusy || connecting || recordingPending || props.recording} onClick={() => void startLive()}>{!props.signedIn ? "Sign in for xAI realtime" : connecting ? "Connecting to xAI…" : "Start xAI realtime"}</button>}
        {props.answerReceipt && <p className="speak-call__transcript">Answer from {props.answerReceipt}</p>}
        {props.callError && <p className="speak-call__transcript" role="alert">{props.callError}</p>}
        {notice && <p className="speak-call__transcript" data-testid="speak-speech-cut" role="status">{notice}</p>}
        {showTranscript && transcript && <p className="speak-call__transcript" data-testid="speak-transcript">{transcript}</p>}
      </section>
      <div className="speak-call__dock">
      <div className="speak-call__pills" aria-label="Call controls">
        <button type="button" aria-label="Camera" aria-pressed={source === "camera"} disabled={props.halted} onClick={() => void show("camera")}><Camera /></button>
        {source !== "none" && <button type="button" disabled={props.halted || !props.onAttachImage} onClick={() => void attachFrame()}>Attach frame</button>}
        <button type="button" disabled={props.halted} aria-label="Screen share" aria-pressed={source === "screen"} onClick={() => void show("screen")}><MonitorUp /></button>
        <button type="button" aria-label={speakerMuted ? "Unmute speaker" : "Mute speaker"} aria-pressed={speakerMuted} onClick={toggleSpeaker}>{speakerMuted ? <VolumeX /> : <Volume2 />}</button>
        <button type="button" disabled={!props.live} aria-label={activation === "push" ? "Hold to talk" : props.micMuted ? "Unmute microphone" : "Mute microphone"} aria-pressed={props.live && !props.micMuted}
          onClick={() => { if (activation !== "push") props.onMicMute(!props.micMuted); }}
          onPointerDown={(event) => { if (activation === "push") { event.currentTarget.setPointerCapture(event.pointerId); held.current = true; props.onMicMute(false); } }}
          onLostPointerCapture={() => { if (held.current) { held.current = false; props.onMicMute(true); } }}
          onKeyDown={(event) => { if (activation === "push" && (event.key === " " || event.key === "Enter")) { event.preventDefault(); held.current = true; props.onMicMute(false); } }}
          onKeyUp={() => { if (held.current) { held.current = false; props.onMicMute(true); } }}
          onBlur={() => { if (held.current) { held.current = false; props.onMicMute(true); } }}
        >{props.micMuted || !props.live ? <MicOff /> : <Mic />}</button>
        <button ref={settingsButton} type="button" aria-label="Voice settings" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings /></button>
        <button type="button" className="speak-call__notes" aria-label="Transcript" aria-pressed={showTranscript} onClick={() => setShowTranscript((open) => !open)}><AudioLines /></button>
        <button type="button" className="speak-call__code" aria-label="Open in Intelligence" onClick={() => props.onHandCode?.(line.trim() || props.heard || props.spoken || "")}>Code</button>
      </div>
      <form className="speak-call__bar" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <button type="button" aria-label="Add a file" onClick={() => fileRef.current?.click()}><Plus /></button>
        <input aria-label="Ask Anything" placeholder="Ask Anything" value={line} onChange={(event) => setLine(event.target.value)} />
        {(line.trim() || attachedNames.length > 0) && <button type="submit" aria-label="Send to Adrian" disabled={asking || props.halted}><ArrowUp /></button>}
        <button type="button" className="speak-call__end" aria-label="End call" onClick={() => { stopVideo(); props.onClose(); }}><PhoneOff /></button>
      </form>
      {attachedNames.length > 0 ? (
        <div className="speak-call__transcript" data-testid="speak-attachments" aria-label="Speak attachments">
          {attachedNames.map((name, index) => (
            <span key={`${name}-${index}`}>{name}<button type="button" aria-label={`Remove ${name}`} onClick={() => props.onRemoveAttachment?.(index)}>×</button></span>
          ))}
        </div>
      ) : null}
      </div>
      {settingsOpen ? (
        <section className="speak-sheet" aria-label="Voice settings">
          <header>
            <button ref={closeSettingsButton} type="button" aria-label="Close voice settings" onClick={closeSettings}><X /></button>
            <h2>Voice settings</h2>
          </header>
          <button type="button" className="speak-sheet__voice" onClick={() => chooseVoice(VOICES[(VOICES.findIndex((item) => item.id === voice) + 1) % VOICES.length].id)}>
            <span>xAI voice</span>
            <strong>{voiceDisplayName(voice)}</strong>
          </button>
          <p>Personality</p>
          <p className="text-xs text-muted">Personality changes how the reply is written. This voice choice applies to xAI output; OpenAI output uses Alloy.</p>
          <div className="speak-sheet__styles">
            {STYLES.map((item) => <button key={item} type="button" aria-pressed={style === item} onClick={() => chooseStyle(item)}>{item}</button>)}
          </div>
          <label className="speak-sheet__volume">Volume
            <input aria-label="Speaker volume" type="range" min={0} max={100} value={volume} onChange={(event) => chooseVolume(Number(event.target.value))} />
          </label>
          <p>Voice activation</p>
          <div className="speak-sheet__activation" role="group" aria-label="Voice activation">
            {ACTIVATION.map((item) => <button key={item.id} type="button" aria-pressed={activation === item.id} onClick={() => chooseActivation(item.id)}>{item.label}</button>)}
          </div>
          <div className="speak-sheet__rates" role="group" aria-label="Speaking pace">
            {RATES.map((item) => <button key={item.id} type="button" aria-pressed={rate === item.id} onClick={() => chooseRate(item.id)}>{item.label}</button>)}
          </div>
          {props.onKeepRecording && <button type="button" disabled={!props.signedIn || props.halted || connecting || props.live || props.recording || recordingPending} onClick={() => void startRecording()}>Record this tab separately</button>}
          {!props.signedIn ? <button type="button" onClick={props.onSignIn}>Sign in to start the live call</button> : null}
        </section>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (!props.onAttachImage) {
            setNotice("Image attachment is unavailable in this Speak session.");
            return;
          }
          setNotice(`Preparing ${file.name}…`);
          void props.onAttachImage(file).then((result) => {
            if (!openRef.current) return;
            if (!result.ok) { setNotice(result.error); return; }
            setShowTranscript(true);
            setNotice(`${result.name} is attached to the active Speak turn. Speak stays open.`);
          }).catch(() => {
            if (openRef.current) setNotice("That image could not be attached. Speak stayed open.");
          });
        }}
      />
    </div>
  );
  if (typeof document === "undefined") return stage;
  return createPortal(stage, document.body);
}
