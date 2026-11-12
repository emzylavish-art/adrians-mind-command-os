import { useEffect, useRef, useState } from "react";
import { Camera, Mic, MicOff, MonitorUp, PhoneOff, X } from "lucide-react";
import { openCameraStream, openScreenStream } from "@/components/mind/live-voice-bar/frame-capture";

const VOICE_STYLES = ["Direct", "Warm", "Professional", "Playful"] as const;

/**
 * Full-screen Speak call, matched to the Grok voice screen:
 * black field, live camera or shared screen, and four working controls.
 * Camera and screen share are local captures. They do not upload until a signed-in call is connected.
 */
export function SpeakStage(props: {
  open: boolean;
  signedIn: boolean;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [source, setSource] = useState<"none" | "camera" | "screen">("none");
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [style, setStyle] = useState<(typeof VOICE_STYLES)[number]>("Warm");

  useEffect(() => {
    const saved = window.localStorage.getItem("adrian-speak-style");
    if (saved && (VOICE_STYLES as readonly string[]).includes(saved)) setStyle(saved as (typeof VOICE_STYLES)[number]);
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSource("none");
  }

  useEffect(() => {
    if (!props.open) stopStream();
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [props.open]);

  async function show(next: "camera" | "screen") {
    if (source === next) {
      stopStream();
      setNotice(null);
      return;
    }
    stopStream();
    const opened = next === "camera" ? await openCameraStream() : await openScreenStream();
    if (!opened.ok) {
      setNotice(opened.error);
      return;
    }
    streamRef.current = opened.stream;
    opened.stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopStream();
      setNotice(next === "screen" ? "Screen share ended." : "Camera ended.");
    });
    if (videoRef.current) {
      videoRef.current.srcObject = opened.stream;
      await videoRef.current.play().catch(() => undefined);
    }
    setSource(next);
    setNotice(next === "camera" ? "Camera is on. It stays on this device until you end the call." : "Screen share is on. It stays on this device until you end the call.");
  }

  if (!props.open) return null;

  return (
    <div className="speak-stage" role="dialog" aria-modal="true" aria-label="Speak" data-testid="speak-stage">
      <header>
        <p className="flex items-center gap-2"><img src="/brand/marks/speak.png" alt="" width={28} height={28} className="size-7 rounded-lg" />Speak</p>
        <button type="button" aria-label="Close Speak" onClick={props.onClose}><X /></button>
      </header>
      <video ref={videoRef} className={source === "none" ? "is-hidden" : source} playsInline muted autoPlay />
      {source === "none" ? <div className="speak-orb" aria-hidden="true" /> : null}
      <p className="speak-status" role="status">
        {source === "camera" ? "Camera on" : source === "screen" ? "Sharing your screen" : muted ? "Microphone muted" : `${style} voice`}
      </p>
      <div className="speak-styles" role="group" aria-label="Voice style">
        {VOICE_STYLES.map((item) => (
          <button key={item} type="button" aria-pressed={style === item} onClick={() => { setStyle(item); window.localStorage.setItem("adrian-speak-style", item); }}>{item}</button>
        ))}
      </div>
      {notice ? <p className="speak-notice">{notice}</p> : null}
      {!props.signedIn ? (
        <button type="button" className="speak-signin" onClick={props.onSignIn}>Sign in to start the live call</button>
      ) : null}
      <div className="speak-controls">
        <button type="button" aria-label="Camera" aria-pressed={source === "camera"} onClick={() => void show("camera")}><Camera /></button>
        <button type="button" aria-label="Screen share" aria-pressed={source === "screen"} onClick={() => void show("screen")}><MonitorUp /></button>
        <button type="button" aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted} onClick={() => setMuted((on) => !on)}>{muted ? <MicOff /> : <Mic />}</button>
        <button type="button" className="end" aria-label="End call" onClick={() => { stopStream(); props.onClose(); }}><PhoneOff /></button>
      </div>
    </div>
  );
}
