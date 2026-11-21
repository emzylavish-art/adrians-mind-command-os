import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Camera, Mic, MicOff, MonitorUp, PhoneOff, Plus, Settings, Volume2, VolumeX, X } from "lucide-react";
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
  live?: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onLive?: () => void;
  onAsk?: (text: string) => Promise<string | null | { reply?: string; error?: string }>;
  onKeepRecording?: (stream: MediaStream) => void;
  onEmergencyStop?: () => void;
  halted?: boolean;
  onClearStop?: () => void;
  onHandCode?: (text: string) => void;
  onStyle?: (style: string) => void;
  heard?: string;
  spoken?: string;
  callError?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef(props.onKeepRecording);
  keepRef.current = props.onKeepRecording;
  const [source, setSource] = useState<"none" | "camera" | "screen">("none");
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
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
  const [calling, setCalling] = useState(false);
  const [callHeard, setCallHeard] = useState("");
  const callAbortRef = useRef<AbortController | null>(null);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechCutRef = useRef(false);
  const cutSpeechRef = useRef<(reason: "owner" | "tab") => void>(() => undefined);

  function cutSpeech(reason: "owner" | "tab") {
    speechCutRef.current = true;
    callAbortRef.current?.abort();
    callAbortRef.current = null;
    const playing = callAudioRef.current;
    if (playing) {
      playing.pause();
      try { playing.currentTime = 0; } catch { /* a closed element can refuse */ }
      playing.removeAttribute("src");
      playing.load();
      callAudioRef.current = null;
    }
    document.querySelectorAll("audio").forEach((element) => {
      element.pause();
      try { element.currentTime = 0; } catch { /* ignore */ }
    });
    window.speechSynthesis?.cancel();
    setCalling(false);
    setReply("");
    const message = reason === "tab"
      ? "Speech cut. The tab is closing."
      : "Speech cut. Emergency stop is on. EVE can press Clear.";
    setNotice(message);
    if (reason === "owner") props.onEmergencyStop?.();
  }
  cutSpeechRef.current = cutSpeech;

  function clearStop() {
    speechCutRef.current = false;
    setCalling(false);
    setReply("");
    setNotice("EVE cleared the stop. Speech can start again.");
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
    setVoice(readStoredVoiceChoice(window.localStorage));
    const saved = window.localStorage.getItem("adrian-speak-rate");
    if (saved === "slow" || saved === "natural" || saved === "brisk") setRate(saved);
    const savedStyle = window.localStorage.getItem("adrian-speak-style");
    if (savedStyle === "Storyteller" || savedStyle === "Supportive" || savedStyle === "Playful" || savedStyle === "Calm" || savedStyle === "Unhinged") setStyle(savedStyle);
    const savedVolume = Number(window.localStorage.getItem("adrian-speak-volume"));
    if (Number.isFinite(savedVolume)) setVolume(Math.min(100, Math.max(0, savedVolume)));
    const savedActivation = window.localStorage.getItem("adrian-speak-activation");
    if (savedActivation === "default" || savedActivation === "isolation" || savedActivation === "push") setActivation(savedActivation);
  }, []);

  useEffect(() => {
    if (props.live) setNotice((current) => current?.startsWith("Connecting") ? "Live. Speak, and EVE answers on this call." : current);
  }, [props.live]);

  function stopVideo() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSource("none");
  }

  function stopMic() {
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    setListening(false);
  }

  useEffect(() => {
    if (!props.open) {
      stopVideo();
      const kept = micRef.current;
      if (kept && keepRef.current) {
        micRef.current = null;
        setListening(false);
        keepRef.current(kept);
      } else {
        stopMic();
      }
      setSettingsOpen(false);
      document.documentElement.classList.remove("eve-call-open");
    } else {
      document.documentElement.classList.add("eve-call-open");
    }
    return () => {
      document.documentElement.classList.remove("eve-call-open");
    };
  }, [props.open]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const kept = micRef.current;
      if (kept && keepRef.current) keepRef.current(kept);
      else kept?.getTracks().forEach((track) => track.stop());
      micRef.current = null;
      streamRef.current = null;
    };
  }, []);

  async function show(next: "camera" | "screen") {
    if (source === next) {
      stopVideo();
      setNotice(null);
      return;
    }
    stopVideo();
    const opened = next === "camera" ? await openCameraStream() : await openScreenStream();
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

  async function toggleMic() {
    if (listening) {
      stopMic();
      if (props.onLive && props.live) props.onLive();
      setNotice("Recording stopped.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("This browser cannot open the microphone.");
      return;
    }
    try {
      const status = await navigator.permissions?.query?.({ name: "microphone" as PermissionName }).catch(() => null);
      if (status?.state === "denied") {
        setNotice("Microphone permission is blocked for this site. Allow it once in the browser settings, then return here.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: activation === "isolation"
          ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : true,
      });
      stream.getTracks().forEach((track) => {
        track.enabled = true;
      });
      micRef.current = stream;
      setListening(true);
      setMuted(false);
      setNotice("Recording this tab. Leave this screen and it keeps running.");
      props.onLive?.();
    } catch {
      setNotice("Microphone permission was blocked. Allow it for this site, then press the mic again.");
    }
  }

  function chooseVoice(next: XaiBuiltinVoice) {
    const stored = writeStoredVoiceChoice(next, window.localStorage);
    setVoice(stored);
    setNotice(`${voiceDisplayName(stored)} is saved for Speak.`);
  }

  function chooseRate(next: RateId) {
    setRate(next);
    try {
      window.localStorage.setItem("adrian-speak-rate", next);
    } catch {
      /* private mode */
    }
    setNotice(`${next} pace is saved.`);
  }

  function chooseStyle(next: StyleId) {
    setStyle(next);
    try { window.localStorage.setItem("adrian-speak-style", next); } catch { /* private mode */ }
    props.onStyle?.(next);
    setNotice(`${next} is saved for this call.`);
  }

  function chooseVolume(next: number) {
    const level = Math.min(100, Math.max(0, next));
    setVolume(level);
    try { window.localStorage.setItem("adrian-speak-volume", String(level)); } catch { /* private mode */ }
    document.querySelectorAll("audio").forEach((element) => { element.volume = level / 100; });
    setNotice(level === 0 ? "Speaker volume is off." : `Speaker volume is ${level}.`);
  }

  function chooseActivation(next: ActivationId) {
    setActivation(next);
    try { window.localStorage.setItem("adrian-speak-activation", next); } catch { /* private mode */ }
    setNotice(next === "push" ? "Push to talk is saved. Hold the microphone to talk." : next === "isolation" ? "Voice isolation is saved for the next microphone open." : "Default voice activation is saved.");
  }

  function toggleSpeaker() {
    const next = !speakerMuted;
    setSpeakerMuted(next);
    document.querySelectorAll("audio").forEach((element) => { element.muted = next; });
    if (next) window.speechSynthesis?.cancel();
    setNotice(next ? "Speaker muted for this call." : "Speaker on.");
  }

  async function ask() {
    const text = line.trim();
    if (!text || !props.onAsk || asking) return;
    setAsking(true);
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

  async function placeCall() {
    if (calling || props.halted || speechCutRef.current) {
      setNotice(props.halted || speechCutRef.current ? "Emergency stop is on. Speech was not started." : "Calling. Speech is being heard and answered.");
      return;
    }
    const abort = new AbortController();
    callAbortRef.current = abort;
    setCalling(true);
    setCallHeard("");
    setReply("");
    setNotice("Calling. Speech is being heard and answered.");
    setShowTranscript(true);
    try {
      const response = await fetch("/api/mind/voice/call", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: abort.signal,
      });
      if (speechCutRef.current || abort.signal.aborted) {
        setNotice("Speech cut. Nothing continued.");
        return;
      }
      const body = await response.json().catch(() => ({})) as { ok?: boolean; heard?: string; reply?: string; audio?: string; error?: string };
      if (speechCutRef.current || abort.signal.aborted) {
        setNotice("Speech cut. Nothing continued.");
        return;
      }
      if (!body.ok || !body.reply) {
        setNotice(body.error || "The call did not finish. Nothing was spoken.");
        return;
      }
      setCallHeard(body.heard || "");
      setReply(body.reply);
      setNotice(`Spoken: ${body.reply}`);
      if (body.audio && !speakerMuted) {
        window.speechSynthesis?.cancel();
        sharedAudioOutput.interrupt();
        window.dispatchEvent(new Event("adrian-one-voice"));
        const audio = new Audio(`data:audio/mpeg;base64,${body.audio}`);
        callAudioRef.current = audio;
        audio.setAttribute("data-speak-call", "true");
        audio.setAttribute("data-testid", "call-audio");
        document.body.appendChild(audio);
        audio.volume = volume / 100;
        if (speechCutRef.current) {
          audio.pause();
          setNotice("Speech cut. Nothing continued.");
          return;
        }
        await audio.play().catch(() => undefined);
      }
    } catch (err) {
      if (speechCutRef.current || (err instanceof DOMException && err.name === "AbortError")) {
        setNotice((current) => current?.startsWith("Speech cut") ? current : "Speech cut. Nothing continued.");
        return;
      }
      setNotice("The call did not finish. Nothing was spoken.");
    } finally {
      setCalling(false);
    }
  }

  if (!props.open) return null;
  const status = source === "camera" ? "Camera on" : source === "screen" ? "Sharing your screen" : props.live ? "Live" : listening ? "Listening" : "Start talking";
  const transcript = [uploadName, notice, props.heard ? `Heard: ${props.heard}` : "", reply || props.spoken || "", props.callError || ""].filter(Boolean).join("\n");
  const callTranscript = [callHeard ? `Heard: ${callHeard}` : "", reply ? `Spoken: ${reply}` : "", notice || ""].filter(Boolean).join("\n");
  const eveState = calling ? "listening" : reply || props.spoken ? "speaking" : listening ? "listening" : "idle";

  const stage = (
    <div className="speak-stage speak-call" role="dialog" aria-modal="true" aria-label="EVE" data-testid="speak-stage" style={{ position: "fixed", inset: 0, zIndex: 500, background: "#07080c" }}>
      <section className="speak-system" data-testid="speak-system" style={{ position: "relative", zIndex: 2, width: "min(100%, 28rem)", color: "#f4f4f5", textAlign: "center" }}>
        <p>System call</p>
        <h2 style={{ fontSize: "1.35rem", fontWeight: 700 }}>Speak talks to the system.</h2>
        <p style={{ marginTop: "0.4rem", color: "#d4d4d8" }}>Emma's video is the face on Intelligence. This call does not show the generated figure. EVE cannot press the emergency stop. EVE can press Clear.</p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", marginTop: "0.8rem" }}>
          <button type="button" data-testid="speak-emergency-stop" onClick={() => cutSpeechRef.current("owner")} style={{ minHeight: "2.75rem", border: "1px solid #fb7185", borderRadius: "0.75rem", padding: "0 0.9rem", color: "#fecdd3", background: "transparent" }}>Emergency stop</button>
          <button type="button" data-testid="speak-clear-stop" onClick={() => clearStop()} style={{ minHeight: "2.75rem", border: "1px solid #86efac", borderRadius: "0.75rem", padding: "0 0.9rem", color: "#bbf7d0", background: "transparent" }}>Clear stop</button>
        </div>
        <p data-testid="speak-speech-cut" role="status">{notice?.startsWith("Speech cut") || notice?.startsWith("EVE cleared") ? notice : props.halted ? "Emergency stop is on. EVE can press Clear." : "Only you can press the emergency stop. EVE can press Clear."}</p>
      </section>
      <p data-testid="speak-face" style={{ position: "relative", zIndex: 2, color: "#d4d4d8" }}>Press Speak once. Mute is beside it. Mic types into the field. Translator translates. This button is Speak.</p>
      <video ref={videoRef} className={source === "none" ? "is-hidden" : source} playsInline muted autoPlay />
      <div className="speak-call__status">
        <AudioLines aria-hidden="true" />
        <p role="status" data-testid="speak-status">{reply ? `Spoken: ${reply}` : status}</p>
        <button type="button" className="speak-call__place" data-testid="speak-once" disabled={calling || props.halted || speechCutRef.current} onClick={() => void placeCall()}>{calling ? "Speaking…" : "Speak"}</button>
      </div>
      {callTranscript ? <p className="speak-call__transcript" data-testid="speak-reply">{callTranscript}</p> : reply || props.spoken || props.callError ? <p className="speak-call__transcript" data-testid="speak-reply">{props.callError || reply || props.spoken}</p> : null}
      {!callTranscript && showTranscript && transcript ? <p className="speak-call__transcript" data-testid="speak-transcript">{transcript}</p> : null}
      <div className="speak-call__pills" aria-label="Call controls">
        <button type="button" aria-label="Screen share" aria-pressed={source === "screen"} onClick={() => void show("screen")}><MonitorUp /></button>
        <button type="button" aria-label={speakerMuted ? "Unmute speaker" : "Mute speaker"} aria-pressed={speakerMuted} onClick={toggleSpeaker}>{speakerMuted ? <VolumeX /> : <Volume2 />}</button>
        <button type="button" aria-label={muted || !(props.live || listening) ? "Unmute microphone" : "Mute microphone"} aria-pressed={(props.live || listening) && !muted} onClick={() => { if (activation === "push" && !listening) return; void toggleMic(); }} onPointerDown={() => { if (activation === "push" && !listening) void toggleMic(); }} onPointerUp={() => { if (activation === "push" && listening) stopMic(); }}>{muted || !(props.live || listening) ? <MicOff /> : <Mic />}</button>
        <button type="button" aria-label="Voice settings" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings /></button>
        <button type="button" className="speak-call__notes" aria-label="Transcript" aria-pressed={showTranscript} onClick={() => setShowTranscript((open) => !open)}><AudioLines /></button>
        <button type="button" className="speak-call__code" aria-label="Open in Intelligence" onClick={() => props.onHandCode?.(line.trim() || props.heard || props.spoken || "")}>Code</button>
      </div>
      <form className="speak-call__bar" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <button type="button" aria-label="Add a file" onClick={() => fileRef.current?.click()}><Plus /></button>
        <input aria-label="Ask Anything" placeholder="Ask Anything" value={line} onChange={(event) => setLine(event.target.value)} />
        <button type="button" className="speak-call__end" aria-label="End call" onClick={() => { stopVideo(); props.onClose(); }}><PhoneOff /></button>
      </form>
      {settingsOpen ? (
        <section className="speak-sheet" aria-label="Voice settings">
          <header>
            <button type="button" aria-label="Close voice settings" onClick={() => setSettingsOpen(false)}><X /></button>
            <h2>Voice settings</h2>
          </header>
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
