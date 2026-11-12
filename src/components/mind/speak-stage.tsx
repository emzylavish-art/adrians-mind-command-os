import { useEffect, useRef, useState } from "react";
import { Camera, Mic, MicOff, MonitorUp, Paperclip, PhoneOff, X } from "lucide-react";
import { openCameraStream, openScreenStream } from "@/components/mind/live-voice-bar/frame-capture";
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

type RateId = (typeof RATES)[number]["id"];

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
  onAsk?: (text: string) => Promise<string | null>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<"none" | "camera" | "screen">("none");
  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const [asking, setAsking] = useState(false);
  const [voice, setVoice] = useState<XaiBuiltinVoice>("eve");
  const [rate, setRate] = useState<RateId>("natural");
  const [uploadName, setUploadName] = useState<string | null>(null);

  useEffect(() => {
    setVoice(readStoredVoiceChoice(window.localStorage));
    const saved = window.localStorage.getItem("adrian-speak-rate");
    if (saved === "slow" || saved === "natural" || saved === "brisk") setRate(saved);
  }, []);

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
      stopMic();
    }
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      micRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      micRef.current = null;
    };
  }, [props.open]);

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
    if (props.onLive) {
      props.onLive();
      setNotice(props.live ? "Speak stopped." : "Connecting. Speak, and Adrian answers on this call.");
      return;
    }
    if (listening) {
      stopMic();
      setNotice("Recording stopped.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("This browser cannot open the microphone.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = stream;
      setListening(true);
      setMuted(false);
      setNotice(props.signedIn ? "Recording. The live reply starts when the voice session connects." : "Recording on this device. Sign in before a live reply can start.");
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

  async function ask() {
    const text = line.trim();
    if (!text || !props.onAsk || asking) return;
    setAsking(true);
    setNotice("Adrian is answering. The reply will be spoken.");
    try {
      const error = await props.onAsk(text);
      setNotice(error ?? "Spoken.");
      if (!error) setLine("");
    } catch {
      setNotice("The reply did not finish. Nothing was spoken.");
    } finally {
      setAsking(false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="speak-stage" role="dialog" aria-modal="true" aria-label="Speak" data-testid="speak-stage">
      <header>
        <div>
          <p>Speak</p>
          <span>Talk with Adrian</span>
        </div>
        <button type="button" aria-label="Close Speak" onClick={props.onClose}><X /></button>
      </header>
      <video ref={videoRef} className={source === "none" ? "is-hidden" : source} playsInline muted autoPlay />
      <div className="speak-stage__body">
        <div className="speak-stage__stage">
          {source === "none" ? <div className={`speak-orb ${props.live || listening ? "is-live" : ""}`} aria-hidden="true" /> : null}
          <div className={`speak-wave ${props.live || listening ? "is-live" : ""}`} aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <p className="speak-status" role="status">
            {source === "camera" ? "Camera on" : source === "screen" ? "Sharing your screen" : props.live || listening ? "Live" : `${voiceDisplayName(voice)} · ${rate}`}
          </p>
          {uploadName ? <p className="speak-file">{uploadName}</p> : null}
          {notice ? <p className="speak-notice">{notice}</p> : null}
          <form className="speak-ask" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            <input aria-label="Type to Speak" placeholder="Type if the mic is blocked" value={line} onChange={(event) => setLine(event.target.value)} />
            <button type="submit" disabled={asking || !line.trim()}>{asking ? "Speaking" : "Speak"}</button>
          </form>
          {!props.signedIn ? (
            <button type="button" className="speak-signin" onClick={props.onSignIn}>Sign in to start the live call</button>
          ) : null}
        </div>
        <section className="speak-voices" aria-label="Speak settings">
          <p>Choose a voice</p>
          <div className="speak-rates" role="group" aria-label="Speaking pace">
            {RATES.map((item) => (
              <button key={item.id} type="button" aria-pressed={rate === item.id} onClick={() => chooseRate(item.id)}>{item.label}</button>
            ))}
          </div>
          <ul>
            {VOICES.map((item) => (
              <li key={item.id}>
                <button type="button" aria-pressed={voice === item.id} onClick={() => chooseVoice(item.id)}>
                  <strong>{voiceDisplayName(item.id)}</strong>
                  <span>{item.line}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="speak-controls">
        <button type="button" aria-label="Camera" aria-pressed={source === "camera"} onClick={() => void show("camera")}><Camera /><span>Camera</span></button>
        <button type="button" aria-label="Upload" onClick={() => fileRef.current?.click()}><Paperclip /><span>Upload</span></button>
        <button type="button" className="mic" aria-label={props.live || listening ? "Stop recording" : "Start recording"} aria-pressed={(props.live || listening) && !muted} onClick={() => void toggleMic()}>{muted || !(props.live || listening) ? <MicOff /> : <Mic />}<span>{props.live || listening ? "Stop" : "Record"}</span></button>
        <button type="button" aria-label="Screen share" aria-pressed={source === "screen"} onClick={() => void show("screen")}><MonitorUp /><span>Screen</span></button>
        <button type="button" className="end" aria-label="End call" onClick={() => { stopVideo(); stopMic(); props.onClose(); }}><PhoneOff /><span>End</span></button>
      </div>
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
          setNotice(`${file.name} is on this screen. It stays on this device until a signed-in call can use it.`);
        }}
      />
    </div>
  );
}
