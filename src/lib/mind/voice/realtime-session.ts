import { SharedAudioOutput, sharedAudioOutput } from "./audio-output.ts";
import { rmsFromTimeDomain } from "./level.ts";
import { rmsLevel } from "./levels.ts";
import { decodeWavPcm, resampleLinear, synthesizeTone } from "./test-audio.ts";
import { resolveXaiVoiceId } from "./voices.ts";

export const REALTIME_ENDPOINT = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const REALTIME_MODEL = "grok-voice-latest";
export const REALTIME_SAMPLE_RATE = 24000;

export type RealtimeHandlers = {
  onTranscript?: (text: string) => void;
  /** Live interim ASR partials; replaced when the final transcript arrives. */
  onPartialTranscript?: (text: string) => void;
  onSpeechStarted?: () => void;
  onError?: (message: string) => void;
  onStatus?: (status: "connecting" | "listening" | "processing" | "speaking" | "idle" | "closed") => void;
  /** 0..1 mic RMS from AnalyserNode while capturing. */
  onLevel?: (level: number) => void;
  /** Fired when the socket closes without an intentional close() (mic released). */
  onUnexpectedClose?: () => void;
};

export type RealtimeSessionOptions = {
  /** Built-in or allowlisted voice id applied on session.update (default eve). */
  voice?: string;
};

export type RealtimeConnectOptions = {
  /** When true, cancel auto model replies so the app owns Direct/Orchestrator routing. */
  captureOnly?: boolean;
  /** Dev-only: stream this WAV URL or tone:440 instead of the mic. */
  testAudioUrl?: string | null;
  /** Optional session instructions (e.g. personality + capture-only). */
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
  private open = false;
  private capturing = false;
  private handlers: RealtimeHandlers;
  private output: SharedAudioOutput;
  private socketFactory: RealtimeSocketFactory;
  private pendingTranscript = "";
  private intentionalClose = false;
  private muted = false;
  private analyser: AnalyserNode | null = null;
  private levelRaf = 0;

  private voiceId: string;
  private captureOnly = true;
  private testAudioUrl: string | null = null;
  private testAudioTimer: ReturnType<typeof setInterval> | null = null;
  private forceSpeak = false;

  constructor(
    handlers: RealtimeHandlers = {},
    output: SharedAudioOutput = sharedAudioOutput,
    socketFactory: RealtimeSocketFactory = defaultSocketFactory,
    options: RealtimeSessionOptions = {},
  ) {
    this.handlers = handlers;
    this.output = output;
    this.socketFactory = socketFactory;
    this.voiceId = resolveXaiVoiceId(options.voice);
  }

  setVoice(voice: string) {
    const next = resolveXaiVoiceId(voice);
    this.voiceId = next;
    if (this.open) {
      this.send({ type: "session.update", session: { voice: next } });
    }
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
    this.intentionalClose = false;
    this.captureOnly = options.captureOnly !== false;
    this.testAudioUrl = options.testAudioUrl || null;
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
        const unexpected = !this.intentionalClose && (this.open || this.capturing || this.media != null);
        this.open = false;
        this.stopCapture();
        this.handlers.onStatus?.("closed");
        if (unexpected) this.handlers.onUnexpectedClose?.();
      });
    });
    this.send({
      type: "session.update",
      session: {
        voice: this.voiceId,
        instructions:
          options.instructions ||
          (this.captureOnly
            ? "You only listen for transcription. Do not answer unless a force_message is sent."
            : "You are a voice capture helper. Prefer short replies when asked to speak."),
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
      const message = msg.error?.message || "Voice realtime error.";
      // Benign: response.cancel when nothing is active (capture-only / barge-in / force_message prep).
      if (/no active response|cancell?ation failed: no active response/i.test(message)) {
        return;
      }
      this.handlers.onError?.(message);
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      if (this.forceSpeak) {
        // Dev test-audio / force_message: ignore VAD barge while assistant audio plays.
        return;
      }
      this.interruptPlayback();
      this.handlers.onSpeechStarted?.();
      this.handlers.onStatus?.("listening");
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.delta" ||
      type === "conversation.item.input_audio_transcription.partial" ||
      type === "input_audio_transcription.delta"
    ) {
      const partial = (msg.delta || msg.transcript || "").trim();
      if (partial) this.handlers.onPartialTranscript?.(partial);
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = (msg.transcript || "").trim();
      if (text) {
        this.pendingTranscript = text;
        // Final replaces any interim partial in the UI.
        this.handlers.onPartialTranscript?.(text);
        this.handlers.onTranscript?.(text);
        this.handlers.onStatus?.("processing");
      }
      return;
    }
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      if (msg.delta) {
        this.handlers.onStatus?.("speaking");
        void this.output.playPcm16Base64(msg.delta, { sampleRate: REALTIME_SAMPLE_RATE });
      }
      return;
    }
    if (type === "response.done") {
      this.forceSpeak = false;
      this.handlers.onStatus?.(this.capturing ? "listening" : "idle");
    }
  }

  /** Cut local playback and cancel in-flight model audio. */
  interruptPlayback() {
    this.forceSpeak = false;
    this.output.interrupt();
    this.send({ type: "response.cancel" });
  }

  async startCapture() {
    if (!this.open) throw new Error("Voice session is not connected.");
    if (this.capturing) return;
    if (this.testAudioUrl) {
      await this.startTestAudioCapture(this.testAudioUrl);
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      // Preserve DOMException name (NotAllowedError / NotFoundError) for UI mapping.
      throw err;
    }
    this.media = media;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
    this.source = this.audioCtx.createMediaStreamSource(media);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (!this.capturing || this.muted) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = floatTo16BitPCM(input);
      this.send({ type: "input_audio_buffer.append", audio: bufferToBase64(pcm) });
    };
    this.source.connect(this.analyser);
    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.capturing = true;
    this.handlers.onStatus?.("listening");
    this.startLevelPump();
  }


  /** Dev-only: push decoded WAV/tone PCM into the realtime input buffer (no mic). */
  private async startTestAudioCapture(url: string) {
    let samples: Float32Array;
    if (url.startsWith("tone:")) {
      samples = synthesizeTone(REALTIME_SAMPLE_RATE, 1.25, Number(url.slice(5)) || 440);
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Test audio ${url} returned ${res.status}.`);
      const decoded = decodeWavPcm(await res.arrayBuffer());
      samples = resampleLinear(decoded.samples, decoded.sampleRate, REALTIME_SAMPLE_RATE);
    }
    this.capturing = true;
    this.handlers.onStatus?.("listening");
    const frame = Math.floor(REALTIME_SAMPLE_RATE * 0.1); // 100ms
    let offset = 0;
    // Lead-in silence so VAD arms.
    const lead = new Float32Array(frame);
    this.send({ type: "input_audio_buffer.append", audio: bufferToBase64(floatTo16BitPCM(lead)) });
    this.testAudioTimer = setInterval(() => {
      if (!this.capturing || !this.open) return;
      if (offset >= samples.length) {
        this.send({ type: "input_audio_buffer.commit" });
        if (this.testAudioTimer) {
          clearInterval(this.testAudioTimer);
          this.testAudioTimer = null;
        }
        this.handlers.onLevel?.(0);
        return;
      }
      const slice = samples.subarray(offset, Math.min(samples.length, offset + frame));
      offset += frame;
      this.handlers.onLevel?.(this.muted ? 0 : rmsLevel(slice));
      if (this.muted) return;
      const pcm = floatTo16BitPCM(slice);
      this.send({ type: "input_audio_buffer.append", audio: bufferToBase64(pcm) });
    }, 100);
  }

  private startLevelPump() {
    const tick = () => {
      if (!this.capturing || !this.analyser || this.muted) {
        this.handlers.onLevel?.(0);
        if (this.capturing && this.analyser) this.levelRaf = requestAnimationFrame(tick);
        return;
      }
      const buf = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(buf);
      this.handlers.onLevel?.(rmsFromTimeDomain(buf));
      this.levelRaf = requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === "function") this.levelRaf = requestAnimationFrame(tick);
  }

  stopCapture() {
    this.capturing = false;
    if (this.testAudioTimer) {
      clearInterval(this.testAudioTimer);
      this.testAudioTimer = null;
    }
    if (this.levelRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.levelRaf);
    this.levelRaf = 0;
    this.handlers.onLevel?.(0);
    this.interruptPlayback();
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
    this.handlers.onStatus?.("idle");
  }

  /** Speak assistant text through the shared realtime → SharedAudioOutput path. */
  speakText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !this.open) return;
    if (this.testAudioTimer) {
      clearInterval(this.testAudioTimer);
      this.testAudioTimer = null;
    }
    this.forceSpeak = true;
    this.output.interrupt();
    this.send({ type: "response.cancel" });
    this.send({
      type: "conversation.item.create",
      item: {
        type: "force_message",
        role: "assistant",
        interruptible: true,
        content: [{ type: "output_text", text: trimmed.slice(0, 500) }],
      },
    });
    this.handlers.onStatus?.("speaking");
  }

  close() {
    this.intentionalClose = true;
    this.stopCapture();
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
