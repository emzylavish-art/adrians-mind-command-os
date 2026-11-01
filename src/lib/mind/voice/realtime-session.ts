import { SharedAudioOutput, sharedAudioOutput } from "./audio-output.ts";
import { rmsLevel } from "./levels.ts";
import { BARGE_IN_HOLD_MS, BARGE_IN_RMS_THRESHOLD } from "./barge-in.ts";

export const REALTIME_ENDPOINT = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const REALTIME_MODEL = "grok-voice-latest";
export const REALTIME_SAMPLE_RATE = 24000;

export type RealtimeHandlers = {
  onTranscript?: (text: string) => void;
  onSpeechStarted?: () => void;
  onError?: (message: string) => void;
  onStatus?: (status: "connecting" | "listening" | "processing" | "speaking" | "idle" | "closed") => void;
  onLevel?: (level: number) => void;
};

export type RealtimeConnectOptions = {
  /** When true, cancel auto model replies so the app owns Direct/Orchestrator routing. */
  captureOnly?: boolean;
  voice?: string;
  instructions?: string;
};

type WsLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: string, listener: (event: MessageEvent | Event) => void) => void;
  removeEventListener?: (type: string, listener: (event: MessageEvent | Event) => void) => void;
};

export type RealtimeSocketFactory = (url: string, protocols: string[]) => WsLike;

function defaultSocketFactory(url: string, protocols: string[]): WsLike {
  return new WebSocket(url, protocols) as unknown as WsLike;
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * Browser realtime voice session. Authenticates with an ephemeral client secret
 * only — never with XAI_VOICE_API_KEY.
 */
export class RealtimeVoiceSession {
  private ws: WsLike | null = null;
  private audioCtx: AudioContext | null = null;
  private media: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private open = false;
  private capturing = false;
  private muted = false;
  private captureOnly = true;
  private handlers: RealtimeHandlers;
  private output: SharedAudioOutput;
  private socketFactory: RealtimeSocketFactory;
  private pendingTranscript = "";
  private responseBusy = false;
  private speakQueue: string[] = [];
  private pendingForce = false;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private speakingHotMs = 0;
  private lastProcessAt = 0;
  private bargeInArmed = false;

  constructor(
    handlers: RealtimeHandlers = {},
    output: SharedAudioOutput = sharedAudioOutput,
    socketFactory: RealtimeSocketFactory = defaultSocketFactory,
  ) {
    this.handlers = handlers;
    this.output = output;
    this.socketFactory = socketFactory;
  }

  get isOpen() {
    return this.open;
  }

  get isCapturing() {
    return this.capturing;
  }

  get isMuted() {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.handlers.onLevel?.(0);
  }

  async connect(ephemeralSecret: string, options: RealtimeConnectOptions = {}) {
    if (!ephemeralSecret) throw new Error("Missing ephemeral voice secret.");
    this.captureOnly = options.captureOnly !== false;
    this.handlers.onStatus?.("connecting");
    const ws = this.socketFactory(REALTIME_ENDPOINT, [`xai-client-secret.${ephemeralSecret}`]);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Voice realtime did not connect in time.")), 15_000);
      const onOpen = () => {
        clearTimeout(timer);
        this.open = true;
        resolve();
      };
      const onError = () => {
        clearTimeout(timer);
        reject(new Error("Voice realtime connection failed."));
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("message", (event) => this.onMessage(event as MessageEvent));
      ws.addEventListener("close", () => {
        this.open = false;
        this.capturing = false;
        this.handlers.onStatus?.("closed");
      });
    });
    this.send({
      type: "session.update",
      session: {
        voice: options.voice || "eve",
        instructions:
          options.instructions ||
          (this.captureOnly
            ? "You only listen for transcription. Do not answer unless a force_message is sent."
            : "You are a helpful realtime voice assistant."),
        turn_detection: { type: "server_vad" },
        audio: {
          input: { format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE } },
          output: { format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE } },
        },
      },
    });
    this.handlers.onStatus?.("listening");
  }

  private send(payload: unknown) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(payload));
  }

  private flushSpeakQueue() {
    if (this.responseBusy || !this.speakQueue.length) return;
    const next = this.speakQueue.shift();
    if (!next) return;
    this.responseBusy = true;
    this.pendingForce = true;
    this.send({
      type: "conversation.item.create",
      item: {
        type: "force_message",
        role: "assistant",
        interruptible: true,
        content: [{ type: "output_text", text: next.slice(0, 500) }],
      },
    });
    this.speakingHotMs = 0;
    this.bargeInArmed = true;
    this.handlers.onStatus?.("speaking");
  }

  private onMessage(event: MessageEvent) {
    const raw = typeof event.data === "string" ? event.data : null;
    if (!raw) return;
    let msg: {
      type?: string;
      transcript?: string;
      delta?: string;
      error?: { message?: string; code?: string };
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    const type = msg.type || "";
    if (type === "error") {
      this.handlers.onError?.(msg.error?.message || "Voice realtime error.");
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      this.interruptPlayback({ reason: "speech" });
      this.handlers.onSpeechStarted?.();
      this.handlers.onStatus?.("listening");
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = (msg.transcript || "").trim();
      if (text) {
        this.pendingTranscript = text;
        this.handlers.onTranscript?.(text);
        this.handlers.onStatus?.("processing");
      }
      return;
    }
    if (type === "response.created") {
      this.responseBusy = true;
      if (this.captureOnly && this.speakQueue.length === 0 && !this.pendingForce) {
        // Auto reply from server VAD — cancel so Direct/Orchestrator own the reply.
        this.send({ type: "response.cancel" });
      }
      return;
    }
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      if (msg.delta) {
        this.handlers.onStatus?.("speaking");
        void this.output.playPcm16Base64(msg.delta, { sampleRate: REALTIME_SAMPLE_RATE }).then(() => {
          /* level from playback approximated below */
        });
        // Approximate speak level from PCM magnitude without full decode cost.
        try {
          const bin = atob(msg.delta);
          let peak = 0;
          for (let i = 0; i + 1 < bin.length; i += 2) {
            const sample = (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)) << 16 >> 16;
            peak = Math.max(peak, Math.abs(sample) / 32768);
          }
          this.handlers.onLevel?.(Math.min(1, peak * 1.4));
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (type === "response.done") {
      this.responseBusy = false;
      this.pendingForce = false;
      this.bargeInArmed = this.speakQueue.length > 0;
      this.speakingHotMs = 0;
      this.handlers.onStatus?.(this.capturing ? "listening" : "idle");
      this.flushSpeakQueue();
    }
  }

  /** Cut local playback and cancel in-flight model audio. */
  interruptPlayback(options?: { reason?: "speech" | "manual" | "rms" | "stop" }) {
    const wasSpeaking = this.responseBusy || this.pendingForce || this.speakQueue.length > 0;
    this.output.interrupt();
    this.speakQueue = [];
    this.pendingForce = false;
    this.responseBusy = false;
    this.speakingHotMs = 0;
    this.send({ type: "response.cancel" });
    if (wasSpeaking && options?.reason && options.reason !== "stop") {
      this.handlers.onStatus?.("listening");
    }
  }

  /** Manual barge-in from the overlay Interrupt button. */
  interruptFromUser() {
    this.interruptPlayback({ reason: "manual" });
    this.handlers.onSpeechStarted?.();
    this.handlers.onStatus?.("listening");
  }

  async startCapture() {
    if (!this.open) throw new Error("Voice session is not connected.");
    if (this.capturing) return;
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.media = media;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
    this.source = this.audioCtx.createMediaStreamSource(media);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (!this.capturing) return;
      const input = ev.inputBuffer.getChannelData(0);
      const level = this.muted ? 0 : rmsLevel(input);
      this.handlers.onLevel?.(level);
      // Local barge-in: sustained RMS while TTS/force_message is playing.
      if (this.bargeInArmed && (this.responseBusy || this.pendingForce) && !this.muted) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const dt = this.lastProcessAt ? Math.min(50, now - this.lastProcessAt) : 0;
        this.lastProcessAt = now;
        if (level >= BARGE_IN_RMS_THRESHOLD) this.speakingHotMs += dt;
        else this.speakingHotMs = 0;
        if (this.speakingHotMs >= BARGE_IN_HOLD_MS) {
          this.bargeInArmed = false;
          this.speakingHotMs = 0;
          this.interruptPlayback({ reason: "rms" });
          this.handlers.onSpeechStarted?.();
          this.handlers.onStatus?.("listening");
        }
      } else {
        this.speakingHotMs = 0;
        this.lastProcessAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      }
      if (this.muted) return;
      const pcm = floatTo16BitPCM(input);
      this.send({ type: "input_audio_buffer.append", audio: bufferToBase64(pcm) });
    };
    this.source.connect(this.analyser);
    this.analyser.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.capturing = true;
    this.handlers.onStatus?.("listening");
  }

  stopCapture() {
    this.capturing = false;
    this.interruptPlayback();
    if (this.levelTimer) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    try {
      this.processor?.disconnect();
      this.analyser?.disconnect();
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.analyser = null;
    this.source = null;
    this.media?.getTracks().forEach((track) => track.stop());
    this.media = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.handlers.onLevel?.(0);
    this.handlers.onStatus?.("idle");
  }

  /** Speak assistant text through force_message after any cancelled auto-reply settles. */
  speakText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !this.open) return;
    this.output.interrupt();
    this.speakQueue.push(trimmed);
    this.pendingForce = true;
    if (!this.responseBusy) this.flushSpeakQueue();
  }

  close() {
    this.stopCapture();
    this.speakQueue = [];
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.open = false;
    this.handlers.onStatus?.("closed");
  }
}
