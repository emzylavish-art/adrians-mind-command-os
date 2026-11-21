import { useEffect, useRef, useState } from "react";
import { NUANCE_PERSONAS, type NuancePersonaChoice } from "@/lib/mind/nuance-live";

type NuanceUser = {
  audioTrack?: unknown;
  isMuted?: boolean;
  isSpeaking?: boolean;
  muteAudio: () => Promise<void>;
  unmuteAudio: () => Promise<void>;
};

type NuanceConversation = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  user: NuanceUser;
  onChange: (callback: (event: { type: string; reason?: string }) => void) => void;
  onInterfaceEvent: (callback: (event: { type: string; delta?: unknown }) => void) => void;
  sendInterfaceEvent: (event: { type: "response.create"; response: { instructions: string } }) => Promise<void>;
  avatar: {
    videoTrack?: { attach: (element: HTMLVideoElement) => void } | null;
    audioTrack?: { attach: (element: HTMLAudioElement) => void } | null;
  };
};

type NuanceSdk = {
  createNuanceConversation: (options: {
    token: () => Promise<string>;
    mediaDevices?: { cameraEnabled?: boolean; microphoneId?: string };
  }) => NuanceConversation;
};

async function loadSdk(): Promise<NuanceSdk> {
  return import("@nuancelabs/js-sdk") as unknown as Promise<NuanceSdk>;
}

function callError(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "MediaAccessError") return "The microphone could not open. The call was not started.";
  if (name === "LegalRequiredError") return "Nuance still needs the developer agreement on their platform. The call was not started.";
  if (name === "WebRTCUnavailableError") return "This browser cannot make the video call.";
  return "The video call could not start. Nothing was started.";
}

function safeStatus(error: unknown, fallback: string): string {
  const named = error instanceof Error && error.message && !error.message.includes("nk_") && !error.message.includes("st_")
    ? error.message
    : "";
  if (
    named.startsWith("The ")
    || named.startsWith("Nuance ")
    || named.startsWith("A ")
    || named.startsWith("Too ")
    || named.startsWith("Emma ")
    || named.startsWith("That ")
  ) return named;
  return fallback;
}

async function openMicrophone(): Promise<{ ok: true; deviceId: string; stop: () => void } | { ok: false; error: string }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "This browser cannot open the microphone. The call was not started." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = stream.getAudioTracks()[0];
    const deviceId = track?.getSettings().deviceId ?? "";
    return {
      ok: true,
      deviceId,
      stop: () => {
        stream.getTracks().forEach((item) => item.stop());
      },
    };
  } catch {
    return { ok: false, error: "The microphone could not open. The call was not started." };
  }
}

export function NuanceCallCard(props: { halted: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const conversationRef = useRef<NuanceConversation | null>(null);
  const mintOnce = useRef(false);
  const tokenIssued = useRef(false);
  const [configured, setConfigured] = useState(false);
  const [personas, setPersonas] = useState<readonly NuancePersonaChoice[]>(NUANCE_PERSONAS);
  const [persona, setPersona] = useState("sonia");
  const [keyDraft, setKeyDraft] = useState("");
  const [status, setStatus] = useState("Checking the saved key.");
  const [mic, setMic] = useState("Microphone is off.");
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState(false);
  const [transcript, setTranscript] = useState("");

  async function releaseServerCall() {
    await fetch("/api/mind/nuance/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    }).catch(() => undefined);
  }

  async function hangUp() {
    const current = conversationRef.current;
    conversationRef.current = null;
    mintOnce.current = false;
    tokenIssued.current = false;
    setLive(false);
    setMuted(false);
    setMic("Microphone is off.");
    if (current) {
      try {
        await current.disconnect();
      } catch {
        // The room is already gone.
      }
    }
    await releaseServerCall();
  }

  useEffect(() => {
    const cut = () => { void hangUp(); };
    window.addEventListener("pagehide", cut);
    return () => {
      window.removeEventListener("pagehide", cut);
      void hangUp();
    };
  }, []);

  useEffect(() => {
    if (props.halted) void hangUp();
  }, [props.halted]);

  useEffect(() => {
    let stop = false;
    void fetch("/api/mind/nuance/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) => response.json())
      .then((data: { configured?: boolean; personas?: NuancePersonaChoice[]; active?: number }) => {
        if (stop) return;
        const saved = data.configured === true;
        setConfigured(saved);
        if (Array.isArray(data.personas) && data.personas.length > 0) setPersonas(data.personas);
        const open = typeof data.active === "number" && data.active > 0;
        setStatus(open
          ? "A video call is already open. Hang up before starting another."
          : saved
            ? "Key saved on this computer."
            : "Paste a Nuance key to start a video call.");
      })
      .catch(() => {
        if (!stop) setStatus("The key status could not be read.");
      });
    return () => { stop = true; };
  }, []);

  async function saveKey() {
    setStatus("Saving the key.");
    const response = await fetch("/api/mind/nuance/key", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: keyDraft.trim() }),
    });
    const data = await response.json() as { ok?: boolean; error?: string };
    setKeyDraft("");
    if (!response.ok || data.ok !== true) {
      setConfigured(false);
      setStatus(data.error || "The key was not saved.");
      return;
    }
    setConfigured(true);
    setStatus("Key saved on this computer.");
  }

  async function toggleMute() {
    const current = conversationRef.current;
    if (!current) return;
    if (muted) {
      await current.user.unmuteAudio();
      setMuted(false);
      setMic("Microphone is live.");
      return;
    }
    await current.user.muteAudio();
    setMuted(true);
    setMic("Microphone is muted.");
  }

  async function start() {
    if (props.halted || live || mintOnce.current) return;
    const choice = personas.find((item) => item.id === persona);
    if (!choice?.available) {
      setStatus(choice?.reason || "That persona is not on the Nuance API. Nothing was started.");
      return;
    }
    setTranscript("");
    setStatus("Opening the microphone.");
    const microphone = await openMicrophone();
    if (!microphone.ok) {
      setMic(microphone.error);
      setStatus(microphone.error);
      return;
    }
    setMic("Microphone is live.");
    microphone.stop();
    mintOnce.current = true;
    tokenIssued.current = false;
    setStatus(`Starting ${choice.name}. One session only.`);
    setLive(true);
    try {
      const sdk = await loadSdk();
      const conversation = sdk.createNuanceConversation({
        token: async () => {
          if (tokenIssued.current) throw new Error("A second session was not started.");
          tokenIssued.current = true;
          const response = await fetch("/api/mind/nuance/session", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "start", persona: choice.id, camera: false }),
          });
          const data = await response.json() as { token?: string; error?: string };
          if (!response.ok || typeof data.token !== "string") {
            throw new Error(data.error || "The video call could not start. Nothing was started.");
          }
          return data.token;
        },
        mediaDevices: {
          cameraEnabled: false,
          ...(microphone.deviceId ? { microphoneId: microphone.deviceId } : {}),
        },
      });
      conversationRef.current = conversation;
      conversation.onInterfaceEvent((event) => {
        if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
          setTranscript((current) => `${current}${event.delta}`.slice(-2000));
        }
      });
      conversation.onChange((event) => {
        const video = videoRef.current;
        const audio = audioRef.current;
        if (event.type === "tracks-changed" && video && audio) {
          conversation.avatar.videoTrack?.attach(video);
          conversation.avatar.audioTrack?.attach(audio);
          if (conversation.user.audioTrack) setMic(conversation.user.isMuted ? "Microphone is muted." : "Microphone is live.");
        }
        if (event.type === "avatar-presented") {
          setStatus(`${choice.name} is on the call. ${choice.name} is an AI.`);
          setMic("Microphone is live.");
          void conversation.sendInterfaceEvent({
            type: "response.create",
            response: { instructions: `Greet the owner in one short sentence and say you are ${choice.name}, an AI.` },
          });
        }
        if (event.type === "session-ended") {
          setLive(false);
          setMic("Microphone is off.");
          setStatus("The video call ended.");
        }
      });
      await conversation.connect();
    } catch (error) {
      await hangUp();
      setStatus(safeStatus(error, callError(error)));
    }
  }

  const emma = personas.find((item) => item.id === "emma");

  return (
    <section className="intelligence-group" aria-label="Video call" data-testid="nuance-call">
      <h3>Video call</h3>
      <p className="text-sm text-muted">Sonia, Sam, and Mira can join a face-to-face call. Each one is an AI. This does not replay an unshared conversation.</p>
      <video ref={videoRef} data-testid="nuance-video" autoPlay playsInline style={{ width: "100%", maxHeight: "24rem", marginTop: "0.75rem", background: "#07080c", borderRadius: "0.75rem" }} />
      <audio ref={audioRef} autoPlay />
      <p className="mt-2 text-sm" role="status" data-testid="nuance-status">{props.halted ? "Emergency stop is on. The video call stays off." : status}</p>
      <p className="mt-1 text-sm" data-testid="nuance-mic">{mic}</p>
      {transcript ? <p className="mt-2 text-sm" data-testid="nuance-transcript">{transcript}</p> : null}
      <label className="mt-3 block text-sm" htmlFor="nuance-persona">Persona</label>
      <select
        id="nuance-persona"
        data-testid="nuance-persona"
        className="mt-2 min-h-11 w-full rounded-panel border border-line bg-transparent px-3 text-sm"
        value={persona}
        disabled={live}
        onChange={(event) => setPersona(event.target.value)}
      >
        {personas.filter((item) => item.available).map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      {emma && !emma.available ? <p className="mt-2 text-sm text-muted" data-testid="nuance-emma">{emma.reason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {live ? (
          <>
            <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" data-testid="nuance-mute" onClick={() => void toggleMute()}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" data-testid="nuance-hangup" onClick={() => void hangUp()}>Hang up</button>
          </>
        ) : (
          <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" data-testid="nuance-start" disabled={props.halted || !configured} onClick={() => void start()}>Start video call</button>
        )}
      </div>
      <form className="mt-4" aria-label="Nuance key" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
        <label className="text-sm" htmlFor="nuance-key">Nuance API key</label>
        <input id="nuance-key" type="password" autoComplete="off" aria-label="Nuance API key" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="Paste a new key" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-transparent px-3 text-sm" />
        <button type="submit" className="mt-2 min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="nuance-save-key">Save key</button>
      </form>
    </section>
  );
}
