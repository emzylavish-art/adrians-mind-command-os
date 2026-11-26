import { useEffect, useRef, useState } from "react";
import { captureComposedSpeech, playComposedSpeech } from "@/lib/mind/voice/composed-browser";
import { runComposedVoiceTurn, type VoiceAnswer, type VoiceStageReceipt } from "@/lib/mind/voice/composed-turn";
import { DEFAULT_VOICE_ROUTE, readVoiceRoutePreferences, writeVoiceRoutePreferences, speechEngineLabel, type VoiceRoutePreferences, type SpeechEngine } from "@/lib/mind/voice/route-preferences";
import { loadVoiceSettings, saveVoiceSettings } from "@/lib/mind/voice/settings";
import { createPortal } from "react-dom";
import { ArrowUp, AudioLines, Camera, Mic, MicOff, MonitorUp, PhoneOff, Plus, Settings, Volume2, VolumeX, X } from "lucide-react";
import { openCameraStream, openScreenStream } from "@/components/mind/live-voice-bar/frame-capture";
import { sharedAudioOutput } from "@/lib/mind/voice/audio-output";
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
  onVoice: (voice: XaiBuiltinVoice) => void;
  micMuted: boolean;
  onMicMute: (muted: boolean) => void;
  recording: boolean;
  ownerId?: string | null;
  answerModelLabel?: string;
  /** Answer only; the composed pipeline owns speech output. */
  onAnswer?: (text: string) => Promise<VoiceAnswer>;
  onAsk?: (text: string) => Promise<string | null | { reply?: string; error?: string }>;
  onKeepRecording?: (stream: MediaStream) => void;
  onEmergencyStop?: () => void;
  halted?: boolean;
  onClearStop?: () => void;
  onHandCode?: (text: string) => void;
  onStyle?: (style: string) => void | Promise<{ active: boolean }>;
  heard?: string;
  spoken?: string;
  callError?: string;
}) {
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
  const [route, setRoute] = useState<VoiceRoutePreferences>({ ...DEFAULT_VOICE_ROUTE });
  const [composedPhase, setComposedPhase] = useState<"idle" | "listening" | "answering" | "speaking">("idle");
  const [stageReceipts, setStageReceipts] = useState<VoiceStageReceipt[]>([]);
  const [composedHeard, setComposedHeard] = useState("");
  const composedAbort = useRef<AbortController | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState("");
  const [voice, setVoice] = useState<XaiBuiltinVoice>("eve");
  const [rate, setRate] = useState<RateId>("natural");
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [style, setStyle] = useState<StyleId>("Storyteller");
  const [activation, setActivation] = useState<ActivationId>("default");
  const [volume, setVolume] = useState(100);
  const [recordingPending, setRecordingPending] = useState(false);
  const speechCutRef = useRef(false);
  const currentOutput = useRef({ muted: speakerMuted, volume: volume / 100, rate: rate === "slow" ? 0.85 : rate === "brisk" ? 1.15 : 1 });
  currentOutput.current = { muted: speakerMuted, volume: volume / 100, rate: rate === "slow" ? 0.85 : rate === "brisk" ? 1.15 : 1 };
  const cutSpeechRef = useRef<(reason: "owner" | "tab") => void>(() => undefined);

  function cutSpeech(reason: "owner" | "tab") {
    speechCutRef.current = true;
    composedAbort.current?.abort();
    composedAbort.current = null;
    setComposedPhase("idle");
    callGeneration.current++;
    mediaGeneration.current++;
    stopVideo();
    sharedAudioOutput.interrupt();
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
    setVoice(readStoredVoiceChoice(window.localStorage));
    const saved = window.localStorage.getItem("adrian-speak-rate");
    if (saved === "slow" || saved === "natural" || saved === "brisk") setRate(saved);
    const savedStyle = window.localStorage.getItem("adrian-speak-style");
    if (savedStyle === "Storyteller" || savedStyle === "Supportive" || savedStyle === "Playful" || savedStyle === "Calm" || savedStyle === "Unhinged") setStyle(savedStyle);
    const savedVolume = Number(window.localStorage.getItem("adrian-speak-volume") ?? "100");
    if (Number.isFinite(savedVolume)) setVolume(Math.min(100, Math.max(0, savedVolume)));
    const savedActivation = loadVoiceSettings(window.localStorage).activation;
    setActivation(savedActivation === "push_to_talk" ? "push" : savedActivation);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
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
      setRecordingPending(false);
      setReply("");
      setNotice(null);
      setSpeakerMuted(false);
      document.documentElement.classList.remove("eve-call-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [props.open]);

  useEffect(() => {
    if (settingsOpen) closeSettingsButton.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    composedAbort.current?.abort();
    composedAbort.current = null;
    setComposedPhase("idle");
    setStageReceipts([]);
    setComposedHeard("");
    setRoute(readVoiceRoutePreferences(window.localStorage, props.ownerId));
    return () => { composedAbort.current?.abort(); };
  }, [props.ownerId, props.open]);

  useEffect(() => {
    if (props.halted || (props.freeOnly && (route.sttProvider !== "browser" || route.ttsProvider !== "browser"))) { composedAbort.current?.abort(); setComposedPhase("idle"); }
  }, [props.halted, props.freeOnly, route.sttProvider, route.ttsProvider]);

  function chooseRoute(next: VoiceRoutePreferences) {
    if (props.live || composedAbort.current) return;
    setRoute(writeVoiceRoutePreferences(window.localStorage, props.ownerId, next));
    setNotice("Voice route saved. It applies to the next turn.");
  }

  async function composedTurn(text?: string) {
    if (!props.onAnswer || composedAbort.current || props.halted) return;
    if (!props.signedIn) { props.onSignIn(); return; }
    const controller = new AbortController();
    composedAbort.current = controller;
    setReply("");
    setStageReceipts([]);
    setShowTranscript(true);
    setNotice(text ? "The selected answer model is answering." : route.sttProvider === "browser" ? "Listening through browser speech. Your browser manages its speech service." : `Recording up to 12 seconds for ${speechEngineLabel(route.sttProvider)} transcription.`);
    const result = await runComposedVoiceTurn({ route: { ...route }, signal: controller.signal, text, freeOnly: props.freeOnly }, {
      capture: (signal) => captureComposedSpeech(route, props.freeOnly === true, signal),
      answer: props.onAnswer,
      speak: (replyText, provider, signal) => playComposedSpeech(replyText, provider, { signal, freeOnly: props.freeOnly === true, voiceId: voice, output: () => currentOutput.current }),
      canSpeak: () => !currentOutput.current.muted,
      onPhase: setComposedPhase,
    });
    if (composedAbort.current !== controller) return;
    composedAbort.current = null;
    setComposedPhase("idle");
    if (!openRef.current || result.canceled) return;
    setReply(result.reply || "");
    setComposedHeard(result.transcript || "");
    setStageReceipts(result.receipts);
    setNotice(result.error || (currentOutput.current.muted ? "Answer ready. Speaker is muted." : "Voice turn complete. Press Speak again for another turn."));
    if (result.ok && text) setLine("");
  }

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
      stopVideo();
      setNotice(next === "screen" ? "Screen share ended." : "Camera ended.");
    });
    if (videoRef.current) {
      videoRef.current.srcObject = opened.stream;
      await videoRef.current.play().catch(() => undefined);
    }
    setSource(next);
    setNotice(next === "camera" ? "Camera is on. It stays on this device until you end Speak." : "Screen share is on. It stays on this device until you end Speak.");
  }

  async function startLive() {
    if (route.mode === "composed" && props.onAnswer) { await composedTurn(); return; }
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
    const stored = writeStoredVoiceChoice(next, window.localStorage);
    setVoice(stored);
    props.onVoice(stored);
    setNotice(`${voiceDisplayName(stored)} is saved for Speak.`);
  }

  function chooseRate(next: RateId) {
    setRate(next);
    try {
      window.localStorage.setItem("adrian-speak-rate", next);
      saveVoiceSettings(window.localStorage, { ...loadVoiceSettings(window.localStorage), speed: next === "natural" ? "normal" : next === "brisk" ? "fast" : "slow" });
    } catch {
      /* private mode */
    }
    setNotice(`${next} pace is saved.`);
  }

  async function chooseStyle(next: StyleId) {
    setStyle(next);
    try { window.localStorage.setItem("adrian-speak-style", next); } catch { /* private mode */ }
    const change = props.onStyle?.(next);
    if (change && typeof change.then === "function") {
      setNotice(`${next} is saved. Updating the live session…`);
      try { const applied = await change; setNotice(applied.active ? `${next} is active for the next turn.` : `${next} is saved for the next live call. Typed answers use it immediately.`); }
      catch { setNotice(`${next} is saved, but the live session did not confirm it. Reconnect to apply it.`); }
    } else setNotice(props.live ? `${next} applies to your next live call. Typed answers use it immediately.` : `${next} is saved for the next turn.`);
  }

  function chooseVolume(next: number) {
    const level = Math.min(100, Math.max(0, next));
    setVolume(level);
    try { window.localStorage.setItem("adrian-speak-volume", String(level)); } catch { /* private mode */ }
    setNotice(level === 0 ? "Speaker volume is off." : `Speaker volume is ${level}.`);
  }

  function chooseActivation(next: ActivationId) {
    setActivation(next);
    if (props.live) props.onMicMute(next === "push");
    saveVoiceSettings(window.localStorage, { ...loadVoiceSettings(window.localStorage), activation: next === "push" ? "push_to_talk" : next });
    setNotice(next === "push" ? "Push to talk is saved. Hold the microphone to talk." : next === "isolation" ? "Voice isolation is saved for the next microphone open." : "Default voice activation is saved.");
  }

  function toggleSpeaker() {
    const next = !speakerMuted;
    setSpeakerMuted(next);
    if (next) window.speechSynthesis?.cancel();
    setNotice(next ? "Speaker muted for this call." : "Speaker on.");
  }

  async function ask() {
    const text = line.trim();
    if (text && props.onAnswer) { await composedTurn(text); return; }
    if (!text || !props.onAsk || asking || props.halted) return;
    if (!props.signedIn) { props.onSignIn(); return; }
    setAsking(true);
    setShowTranscript(true);
    setReply("");
    setNotice("Adrian is answering. The reply will be spoken.");
    try {
      const result = await props.onAsk(text);
      if (result && typeof result === "object") {
        setReply(result.reply ?? "");
        setNotice(result.error ?? (result.reply ? "Spoken." : "The reply did not include text."));
        if (!result.error) setLine("");
      } else {
        setReply("");
        setNotice(result ?? "Spoken.");
        if (!result) setLine("");
      }
    } catch {
      setReply("");
      setNotice("The reply did not finish. Nothing was spoken.");
    } finally {
      setAsking(false);
    }
  }

  if (!props.open) return null;
  const status = props.halted ? "Emergency stop is on" : composedPhase !== "idle" ? `Voice: ${composedPhase}` : route.mode === "native-xai" && props.callError ? "Voice unavailable" : props.live ? (props.micMuted ? "Microphone muted" : "Live conversation") : connecting ? "Connecting…" : "Ready to start";
  const heard = route.mode === "composed" ? composedHeard : props.heard;
  const transcript = [heard && `You: ${heard}`, (reply || props.spoken) && `Adrian: ${reply || props.spoken}`, uploadName].filter(Boolean).join("\n");

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
        const controls = root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([hidden]):not([disabled]), select:not([disabled])');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
    >
      <video ref={videoRef} className={source === "none" ? "is-hidden" : source} playsInline muted autoPlay />
      <div className="speak-call__top">
        <span>Adrian’s Mind <span className="speak-call__provider">/ {route.mode === "native-xai" ? (props.freeOnly ? "Free-only · cloud voice off" : `Native call: xAI · Typed answer: ${props.answerModelLabel || "selected chat model"}`) : `Answer: ${props.answerModelLabel || "selected chat model"}`}</span></span>
        <div className="speak-call__safety">
          <button type="button" data-testid="speak-emergency-stop" onClick={() => cutSpeechRef.current("owner")}>Emergency stop</button>
          {props.halted && <button type="button" data-testid="speak-clear-stop" onClick={clearStop}>Clear stop</button>}
        </div>
      </div>
      <section className="speak-system" data-testid="speak-system">
        <div className="speak-call__symbol" aria-hidden="true"><AudioLines /></div>
        <h2>Speak with Adrian</h2>
        <p role="status" data-testid="speak-status">{status}</p>
        {route.mode === "composed" && <p className="speak-call__transcript" data-testid="voice-route-summary">Listening: {speechEngineLabel(route.sttProvider)} · Answer: {props.answerModelLabel || "selected chat model"} · Speech: {speechEngineLabel(route.ttsProvider)}{route.sttFallbackProvider ? ` · Audio fallback: ${speechEngineLabel(route.sttFallbackProvider)}` : " · Audio fallback off"}</p>}
        {stageReceipts.length > 0 && <p className="speak-call__transcript" data-testid="voice-stage-receipts">{stageReceipts.map((receipt) => `${receipt.stage}: ${receipt.provider}${receipt.model ? ` / ${receipt.model}` : ""}`).join(" · ")}</p>}
        {!props.live && <button type="button" className="speak-call__place" disabled={props.halted || connecting || recordingPending || props.recording || composedPhase !== "idle"} onClick={() => void startLive()}>{!props.signedIn ? "Sign in to speak" : connecting ? "Connecting…" : props.callError ? "Retry live conversation" : route.mode === "composed" ? "Speak a turn" : "Start live conversation"}</button>}
        {composedPhase !== "idle" && <button type="button" onClick={() => { composedAbort.current?.abort(); composedAbort.current = null; setComposedPhase("idle"); setNotice("Voice turn canceled. A model request already sent may still finish in the chat."); }}>Cancel voice turn</button>}
        {route.mode === "native-xai" && props.callError && <p className="speak-call__transcript" role="alert">{props.callError}</p>}
        {notice && <p className="speak-call__transcript" data-testid="speak-speech-cut" role="status">{notice}</p>}
        {showTranscript && transcript && <p className="speak-call__transcript" data-testid="speak-transcript">{transcript}</p>}
      </section>
      <div className="speak-call__dock">
      <div className="speak-call__pills" aria-label="Call controls">
        <button type="button" aria-label="Screen share" aria-pressed={source === "screen"} onClick={() => void show("screen")}><MonitorUp /></button>
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
        {line.trim() && <button type="submit" aria-label="Send to Adrian" disabled={asking || props.halted || composedPhase !== "idle"}><ArrowUp /></button>}
        <button type="button" className="speak-call__end" aria-label="End call" onClick={() => { stopVideo(); props.onClose(); }}><PhoneOff /></button>
      </form>
      </div>
      {settingsOpen ? (
        <section className="speak-sheet" aria-label="Voice settings">
          <header>
            <button ref={closeSettingsButton} type="button" aria-label="Close voice settings" onClick={closeSettings}><X /></button>
            <h2>Voice settings</h2>
          </header>
          {props.onAnswer && <fieldset disabled={props.live || composedPhase !== "idle"}>
            <legend>Voice route</legend>
            <label>Answer mode <select aria-label="Voice answer mode" value={route.mode} onChange={(event) => chooseRoute({ ...route, mode: event.target.value === "native-xai" ? "native-xai" : "composed" })}>
              <option value="composed">Selected chat model</option><option value="native-xai">xAI native realtime</option>
            </select></label>
            {route.mode === "composed" && <>
              <p>Answer model: {props.answerModelLabel || "selected chat model"}. Choose the model in the chat model picker.</p>
              <label>Transcription <select aria-label="Transcription provider" value={route.sttProvider} onChange={(event) => chooseRoute({ ...route, sttProvider: event.target.value as SpeechEngine, sttFallbackProvider: null })}>
                <option value="browser">Browser speech</option><option value="xai">xAI</option><option value="openai">OpenAI</option>
              </select></label>
              <label>Speech output <select aria-label="Speech output provider" value={route.ttsProvider} onChange={(event) => chooseRoute({ ...route, ttsProvider: event.target.value as SpeechEngine })}>
                <option value="browser">Browser speech</option><option value="xai">xAI voice</option><option value="openai">OpenAI / alloy</option>
              </select></label>
              {route.sttProvider !== "browser" && <label><input type="checkbox" checked={route.sttFallbackProvider !== null} onChange={(event) => chooseRoute({ ...route, sttFallbackProvider: event.target.checked ? (route.sttProvider === "xai" ? "openai" : "xai") : null })} />Allow {route.sttProvider === "xai" ? "OpenAI" : "xAI"} to receive this recording if transcription fails</label>}
              <p>Cloud speech requires its configured server credential and can incur provider charges. Browser speech is managed by your browser. Free-only blocks cloud speech.</p>
            </>}
          </fieldset>}
          <button type="button" className="speak-sheet__voice" onClick={() => chooseVoice(VOICES[(VOICES.findIndex((item) => item.id === voice) + 1) % VOICES.length].id)}>
            <span>Voice</span>
            <strong>{voiceDisplayName(voice)}</strong>
          </button>
          <p>Personality</p>
          <p className="text-xs text-muted">Personality changes how the reply is written. Voice changes who speaks it.</p>
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
          <button type="button" aria-pressed={source === "camera"} onClick={() => void show("camera")}><Camera /> Camera</button>
          {props.onKeepRecording && <button type="button" disabled={!props.signedIn || props.halted || connecting || props.live || props.recording || recordingPending} onClick={() => void startRecording()}>Record this tab separately</button>}
          {!props.signedIn ? <button type="button" onClick={props.onSignIn}>Sign in to start the live call</button> : null}
        </section>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,.txt,.md,.csv,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setUploadName(file.name);
          setShowTranscript(true);
          setNotice(`${file.name} is on this screen. It stays on this device until a signed-in call can use it.`);
        }}
      />
    </div>
  );
  if (typeof document === "undefined") return stage;
  return createPortal(stage, document.body);
}
