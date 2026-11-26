import { SharedAudioOutput, sharedAudioOutput } from "./audio-output.ts";
import { rmsFromTimeDomain } from "./level.ts";
import { resolveXaiVoiceId } from "./voices.ts";

export const REALTIME_ENDPOINT = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const REALTIME_MODEL = "grok-voice-latest";
export const REALTIME_SAMPLE_RATE = 24000;

export type RealtimeHandlers = {
  onTranscript?: (text: string) => void;
  /** Spoken reply text from the live call, after the model finishes a turn. */
  onAssistantTranscript?: (text: string) => void;
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
  /** Local orchestration owns the spoken reply. Only receive user transcription here. */
  transcriptOnly?: boolean;
  /** Built-in or allowlisted voice id applied on session.update (default eve). */
  voice?: string;
  voiceIsolation?: boolean;
  /** When omitted, the existing short capture prompt is used. */
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
  private pendingAssistantText = "";
  private responseActive = false;
  private intentionalClose = false;
  private muted = false;
  private analyser: AnalyserNode | null = null;
  private levelRaf = 0;
  private captureRequestId = 0;
  private capturePending = false;

  private voiceId: string;
  private instructions: string;
  private instructionUpdate: { instructions: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private transcriptOnly: boolean;
  private captureMedia: () => Promise<MediaStream>;

  constructor(
    handlers: RealtimeHandlers = {},
    output: SharedAudioOutput = sharedAudioOutput,
    socketFactory: RealtimeSocketFactory = defaultSocketFactory,
    options: RealtimeSessionOptions = {},
    captureMedia: () => Promise<MediaStream> = () => navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        ...(options.voiceIsolation ? { autoGainControl: true } : {}),
      },
    }),
  ) {
    this.handlers = handlers;
    this.transcriptOnly = options.transcriptOnly === true;
    this.output = output;
    this.socketFactory = socketFactory;
    this.voiceId = resolveXaiVoiceId(options.voice);
    this.instructions = options.instructions?.trim() || "You are a voice capture helper. Prefer short replies when asked to speak.";
    this.captureMedia = captureMedia;
  }

  setVoice(voice: string) {
    const next = resolveXaiVoiceId(voice);
    this.voiceId = next;
    if (this.open) {
      this.send({ type: "session.update", session: { voice: next } });
    }
  }

  /** Resolve only after the provider acknowledges the exact new instructions. */
  updateInstructions(instructions: string): Promise<void> {
    const next = instructions.trim();
    if (!next) return Promise.reject(new Error("Voice instructions must not be empty."));
    this.instructions = next;
    if (!this.open || this.ws?.readyState !== 1) return Promise.reject(new Error("Voice is not connected. The style applies to the next call."));
    if (this.instructionUpdate) {
      clearTimeout(this.instructionUpdate.timer);
      this.instructionUpdate.reject(new Error("A newer voice style replaced this update."));
      this.instructionUpdate = null;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.instructionUpdate?.instructions !== next) return;
        this.instructionUpdate = null;
        reject(new Error("The live session did not confirm the new style. Reconnect to apply it."));
      }, 5_000);
      this.instructionUpdate = { instructions: next, resolve, reject, timer };
      try { this.send({ type: "session.update", session: { instructions: next } }); }
      catch {
        clearTimeout(timer); this.instructionUpdate = null;
        reject(new Error("The live session could not receive the new style."));
      }
    });
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
    this.media?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    if (muted) this.handlers.onLevel?.(0);
  }

  async connect(ephemeralSecret: string) {
    if (!ephemeralSecret) throw new Error("Missing ephemeral voice secret.");
    this.intentionalClose = false;
    this.handlers.onStatus?.("connecting");
    const ws = this.socketFactory(REALTIME_ENDPOINT, [`xai-client-secret.${ephemeralSecret}`]);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Voice realtime did not connect in time.")), 15_000);
      const onOpen = () => {
        clearTimeout(timer);
        if (this.ws !== ws || this.intentionalClose) { reject(new Error("Voice session closed.")); return; }
        this.open = true;
        resolve();
      };
      const onError = () => {
        clearTimeout(timer);
        reject(new Error("Voice realtime connection failed."));
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("message", (event) => {
        if (this.open && this.ws === ws && !this.intentionalClose) this.onMessage(event as MessageEvent);
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error("Voice session closed."));
        if (this.ws !== ws || this.intentionalClose) return;
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
        instructions: this.instructions,
        turn_detection: { type: "server_vad" },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
            transcription: { model: "grok-transcribe" },
          },
          output: { format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE } },
        },
      },
    });
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
      session?: { instructions?: string };
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    const type = msg.type || "";
    if (type === "session.updated" && this.instructionUpdate && msg.session?.instructions === this.instructionUpdate.instructions) {
      clearTimeout(this.instructionUpdate.timer);
      this.instructionUpdate.resolve();
      this.instructionUpdate = null;
      return;
    }
    if (this.transcriptOnly && type.startsWith("response.")) {
      if (type === "response.created") this.send({ type: "response.cancel" });
      return;
    }
    if (type === "error") {
      const message = msg.error?.message || "Voice realtime error.";
      if (/no active response/i.test(message)) return;
      if (this.instructionUpdate) {
        clearTimeout(this.instructionUpdate.timer);
        this.instructionUpdate.reject(new Error("The live session rejected the style update."));
        this.instructionUpdate = null;
      }
      this.handlers.onError?.(message);
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      if (this.responseActive) this.interruptPlayback();
      this.handlers.onSpeechStarted?.();
      this.handlers.onStatus?.("listening");
      return;
    }
    if (type === "response.created") {
      this.responseActive = true;
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.delta" ||
      type === "conversation.item.input_audio_transcription.updated" ||
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
        this.responseActive = true;
        this.handlers.onStatus?.("speaking");
        void this.output.playPcm16Base64(msg.delta, { sampleRate: REALTIME_SAMPLE_RATE }).catch(() => {
          this.handlers.onError?.("Audio playback was blocked. End the call and start it again with sound enabled.");
        });
      }
      return;
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta" ||
      type === "response.output_text.delta"
    ) {
      const piece = msg.delta || "";
      if (piece) this.pendingAssistantText += piece;
      return;
    }
    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const text = (msg.transcript || this.pendingAssistantText || "").trim();
      this.pendingAssistantText = "";
      if (text) this.handlers.onAssistantTranscript?.(text);
      return;
    }
    if (type === "response.done") {
      this.responseActive = false;
      const leftover = this.pendingAssistantText.trim();
      this.pendingAssistantText = "";
      if (leftover) this.handlers.onAssistantTranscript?.(leftover);
      this.handlers.onStatus?.(this.capturing ? "listening" : "idle");
    }
  }

  /** Cut local playback and cancel in-flight model audio. */
  interruptPlayback() {
    this.output.interrupt();
    if (!this.responseActive) return;
    this.responseActive = false;
    this.send({ type: "response.cancel" });
  }

  async startCapture() {
    if (!this.open) throw new Error("Voice session is not connected.");
    if (this.capturing || this.capturePending) return;
    const requestId = ++this.captureRequestId;
    this.capturePending = true;
    let media: MediaStream;
    try {
      media = await this.captureMedia();
    } catch (err) {
      const stillCurrent = this.captureRequestId === requestId && this.open;
      if (this.captureRequestId === requestId) this.capturePending = false;
      if (!stillCurrent) return;
      // Preserve DOMException name (NotAllowedError / NotFoundError) for UI mapping.
      throw err;
    }
    // Closing/stopping while the browser permission prompt is open invalidates this request.
    // A late grant must never revive a session after the user has ended it.
    if (this.captureRequestId !== requestId || !this.open) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    this.capturePending = false;
    this.media = media;
    media.getAudioTracks().forEach((track) => { track.enabled = !this.muted; });
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
    const captureRate = this.audioCtx.sampleRate || REALTIME_SAMPLE_RATE;
    if (captureRate !== REALTIME_SAMPLE_RATE) {
      this.send({
        type: "session.update",
        session: {
          audio: {
            input: { format: { type: "audio/pcm", rate: captureRate } },
          },
        },
      });
    }
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
    this.captureRequestId += 1;
    this.capturePending = false;
    this.capturing = false;
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
    this.interruptPlayback();
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
    if (this.instructionUpdate) {
      clearTimeout(this.instructionUpdate.timer);
      this.instructionUpdate.reject(new Error("The live session closed before confirming the style."));
      this.instructionUpdate = null;
    }
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
