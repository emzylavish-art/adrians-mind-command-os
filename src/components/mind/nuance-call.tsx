import { useEffect, useRef, useState } from "react";
import { NUANCE_PERSONAS, type NuancePersonaChoice } from "@/lib/mind/nuance-live";

import { getBearerToken } from "@/lib/auth/client";

function callHeaders(): Record<string, string> {
  const token = getBearerToken();
  return { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

type NuanceUser = {
  audioTrack?: unknown;
  isMuted?: boolean;
  isSpeaking?: boolean;
  muteAudio: () => Promise<void>;
  unmuteAudio: () => Promise<void>;
};

type NuanceConversation = {
  readonly id: string | null;
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
  const generation = useRef(0);
  const mintOnce = useRef(false);
  const tokenIssued = useRef(false);
  const statusRequest = useRef(0);
  const saving = useRef(false);
  const [savingKey, setSavingKey] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [personas, setPersonas] = useState<readonly NuancePersonaChoice[]>(NUANCE_PERSONAS);
  const [persona, setPersona] = useState("sonia");
  const [keyDraft, setKeyDraft] = useState("");
  const [status, setStatus] = useState("Checking the saved key.");
  const [mic, setMic] = useState("Microphone is off.");
  const [muted, setMuted] = useState(false);
  const [changingMic, setChangingMic] = useState(false);
  const [live, setLive] = useState(false);
  const [openingMic, setOpeningMic] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [hasTranscript, setHasTranscript] = useState(false);

  async function releaseServerCall(id: string) {
    return fetch("/api/mind/nuance/session", {
      method: "POST",
      credentials: "same-origin",
      headers: callHeaders(),
      body: JSON.stringify({ action: "end", id }),
    }).then((response) => response.ok).catch(() => false);
  }

  async function hangUp() {
    const closing = ++generation.current;
    const current = conversationRef.current;
    conversationRef.current = null;
    mintOnce.current = false;
    tokenIssued.current = false;
    setOpeningMic(false);
    setLive(false);
    setMuted(false);
    setChangingMic(false);
    setMic("Microphone is off.");
    if (current) {
      setStatus("Ending the video call…");
      let ended = true;
      try {
        await current.disconnect();
      } catch {
        ended = !!current.id && await releaseServerCall(current.id);
      }
      if (!ended && generation.current === closing) setProviderReady(false);
      if (generation.current === closing) setStatus(ended ? "The video call ended." : "The connection closed. The provider could not confirm the call ended.");
    }
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

  async function checkStatus() {
    const request = ++statusRequest.current;
    setChecking(true);
    setProviderReady(false);
    try {
      const response = await fetch("/api/mind/nuance/session", { credentials: "same-origin", headers: callHeaders(), cache: "no-store" });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (request !== statusRequest.current) return;
      const saved = data.configured === true;
      setConfigured(saved);
      if (Array.isArray(data.personas) && data.personas.length) setPersonas(data.personas);
      const ready = saved && data.providerState === "verified" && data.active === 0;
      setProviderReady(ready);
      setStatus(!saved ? "Paste a Nuance key to start a video call." : ready
        ? "Key saved for this account. Nuance verified there are no open calls."
        : data.active > 0 ? "A video call is already open. End that call, then check again."
          : data.providerDetail || "The key is saved. Nuance call status is unavailable.");
    } catch {
      if (request === statusRequest.current) setStatus("The key and provider status could not be confirmed. Check again.");
    } finally {
      if (request === statusRequest.current) setChecking(false);
    }
  }

  useEffect(() => {
    void checkStatus();
    return () => { statusRequest.current++; };
  }, []);

  async function saveKey() {
    if (saving.current || live || openingMic) return;
    saving.current = true;
    const request = ++statusRequest.current;
    setChecking(false);
    setProviderReady(false);
    setSavingKey(true);
    setStatus("Saving the key.");
    try {
      const response = await fetch("/api/mind/nuance/key", {
        method: "POST", credentials: "same-origin", headers: callHeaders(),
        body: JSON.stringify({ key: keyDraft.trim() }),
      });
      const data = await response.json();
      if (request !== statusRequest.current) return;
      if (!response.ok || data.ok !== true || data.configured !== true) {
        setStatus(data.error || "The key save could not be confirmed. Check status before retrying.");
        return;
      }
      setKeyDraft("");
      await checkStatus();
    } catch {
      if (request === statusRequest.current) setStatus("Save could not be confirmed. Check status before retrying.");
    } finally {
      saving.current = false;
      setSavingKey(false);
    }
  }

  async function toggleMute() {
    const current = conversationRef.current;
    if (!current || changingMic) return;
    setChangingMic(true);
    const desired = !muted;
    try {
      if (desired) await current.user.muteAudio();
      else await current.user.unmuteAudio();
      if (conversationRef.current !== current) return;
      setMuted(desired);
      setMic(desired ? "Microphone is muted." : "Microphone is live.");
    } catch {
      if (conversationRef.current === current) setMic("Microphone change could not be confirmed. Try again or hang up.");
    } finally {
      if (conversationRef.current === current) setChangingMic(false);
    }
  }

  async function start() {
    if (props.halted || !providerReady || saving.current || live || mintOnce.current) return;
    const choice = personas.find((item) => item.id === persona);
    if (!choice?.available) {
      setStatus(choice?.reason || "That persona is not on the Nuance API. Nothing was started.");
      return;
    }
    const attempt = ++generation.current;
    mintOnce.current = true;
    setOpeningMic(true);
    setStatus("Opening the microphone.");
    const microphone = await openMicrophone();
    if (attempt !== generation.current) { if (microphone.ok) microphone.stop(); return; }
    setOpeningMic(false);
    if (!microphone.ok) {
      mintOnce.current = false;
      setMic(microphone.error);
      setStatus(microphone.error);
      return;
    }
    setMic("Microphone permission granted. Connecting audio…");
    microphone.stop();
    tokenIssued.current = false;
    setStatus(`Starting ${choice.name}. One session only.`);
    setLive(true);
    try {
      const sdk = await loadSdk();
      if (attempt !== generation.current) return;
      const conversation = sdk.createNuanceConversation({
        token: async () => {
          if (attempt !== generation.current || tokenIssued.current) throw new Error("A second session was not started.");
          tokenIssued.current = true;
          const response = await fetch("/api/mind/nuance/session", {
            method: "POST",
            credentials: "same-origin",
            headers: callHeaders(),
            body: JSON.stringify({ action: "start", persona: choice.id, camera: false }),
          });
          const data = await response.json() as { token?: string; error?: string };
          if (!response.ok || typeof data.token !== "string") {
            throw new Error(data.error || "The session request could not be confirmed. Check call status before retrying.");
          }
          if (attempt !== generation.current) throw new Error("The call was canceled.");
          return data.token;
        },
        mediaDevices: {
          cameraEnabled: false,
          ...(microphone.deviceId ? { microphoneId: microphone.deviceId } : {}),
        },
      });
      conversationRef.current = conversation;
      let receivedText = false;
      let greeted = false;
      conversation.onInterfaceEvent((event) => {
        if (attempt !== generation.current) return;
        if (event.type === "session.output_transcript.delta" && typeof event.delta === "string" && event.delta.length > 0) {
          const delta = event.delta;
          const first = !receivedText;
          receivedText = true;
          if (first) setHasTranscript(true);
          setTranscript(current => (first ? delta : current + delta));
        }
      });
      conversation.onChange((event) => {
        if (attempt !== generation.current) return;
        const video = videoRef.current;
        const audio = audioRef.current;
        if (event.type === "tracks-changed" && video && audio) {
          conversation.avatar.videoTrack?.attach(video);
          conversation.avatar.audioTrack?.attach(audio);
          if (conversation.user.audioTrack) {
            setMuted(!!conversation.user.isMuted);
            setMic(conversation.user.isMuted ? "Microphone is muted." : "Microphone is live.");
          }
        }
        if (event.type === "avatar-presented") {
          setStatus(`${choice.name} is on the call. ${choice.name} is an AI.`);
          setMic(conversation.user.audioTrack && !conversation.user.isMuted ? "Microphone is live." : "Waiting for microphone audio.");
          if (greeted) return;
          greeted = true;
          void conversation.sendInterfaceEvent({
            type: "response.create",
            response: { instructions: `Greet the owner in one short sentence and say you are ${choice.name}, an AI.` },
          }).catch(() => {
            if (attempt === generation.current) setStatus("The greeting could not be confirmed. You can still speak or hang up.");
          });
        }
        if (event.type === "session-ended") {
          if (conversationRef.current !== conversation) return;
          generation.current++;
          conversationRef.current = null;
          mintOnce.current = false;
          tokenIssued.current = false;
          setLive(false);
          setMic("Microphone is off.");
          setChangingMic(false);
          setMuted(false);
          setStatus("The video call ended.");
        }
      });
      await conversation.connect();
    } catch (error) {
      if (attempt !== generation.current) return;
      const requestedSession = tokenIssued.current;
      if (requestedSession) setProviderReady(false);
      const closing = generation.current + 1;
      await hangUp();
      if (generation.current === closing) setStatus(requestedSession ? "The call connection could not be confirmed. Check key and call status before retrying." : safeStatus(error, callError(error)));
    }
  }

  const emma = personas.find((item) => item.id === "emma");

  return (
    <section className="intelligence-group rounded-panel border border-line bg-surface p-4" aria-label="Video call" data-testid="nuance-call">
      <h3>Video call</h3>
      <p className="text-sm text-muted">Sonia, Sam, and Mira can join a face-to-face call. Each one is an AI. This does not replay an unshared conversation.</p>
      <video ref={videoRef} data-testid="nuance-video" autoPlay playsInline style={{ width: "100%", maxHeight: "12rem", marginTop: "0.75rem", background: "#07080c", borderRadius: "0.75rem" }} />
      <audio ref={audioRef} autoPlay />
      <p className="mt-2 text-sm" role="status" data-testid="nuance-status">{props.halted ? "Emergency stop is on. The video call stays off." : status}</p>
      <p className="mt-1 text-sm" data-testid="nuance-mic">{mic}</p>
      {hasTranscript && <label className="mt-2 block text-sm">Editable call transcript
        <textarea className="mt-1 block min-h-24 w-full rounded-panel border border-line bg-transparent p-2" data-testid="nuance-transcript" value={transcript} onChange={event => setTranscript(event.target.value)} />
      </label>}
      <label className="mt-3 block text-sm" htmlFor="nuance-persona">Persona</label>
      <select
        id="nuance-persona"
        data-testid="nuance-persona"
        className="mt-2 min-h-11 w-full rounded-panel border border-line bg-transparent px-3 text-sm"
        value={persona}
        disabled={live || openingMic}
        onChange={(event) => setPersona(event.target.value)}
      >
        {personas.filter((item) => item.available).map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      {emma && !emma.available ? <p className="mt-2 text-sm text-muted" data-testid="nuance-emma">{emma.reason}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {openingMic ? (
          <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" onClick={() => { void hangUp(); setStatus("Microphone request canceled."); }}>Cancel microphone request</button>
        ) : live ? (
          <>
            <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" data-testid="nuance-mute" disabled={changingMic} aria-pressed={muted} onClick={() => void toggleMute()}>{muted ? "Unmute microphone" : "Mute microphone"}</button>
            <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm" data-testid="nuance-hangup" onClick={() => void hangUp()}>Hang up</button>
          </>
        ) : (
          <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50" data-testid="nuance-start" disabled={props.halted || !configured || !providerReady || savingKey || checking} onClick={() => void start()}>Start video call</button>
        )}
      </div>
      {!live && !openingMic && <button type="button" className="min-h-11 px-3 text-sm" disabled={savingKey || checking} onClick={() => void checkStatus()}>{checking ? "Checking call status…" : "Check key and call status"}</button>}
      <details className="mt-4 rounded-panel border border-line p-3">
        <summary className="min-h-11 cursor-pointer text-sm">Key</summary>
      <form className="mt-2" aria-label="Nuance key" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
        <label className="text-sm" htmlFor="nuance-key">Nuance API key</label>
        <input id="nuance-key" disabled={savingKey || live || openingMic} type="password" autoComplete="off" aria-label="Nuance API key" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="Paste a new key" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-transparent px-3 text-sm" />
        <button type="submit" className="mt-2 min-h-11 rounded-panel border border-line px-3 text-sm" data-testid="nuance-save-key" disabled={savingKey || live || openingMic || !keyDraft.trim()}>{savingKey ? "Saving…" : "Save key"}</button>
      </form>
      </details>
    </section>
  );
}
