/**
 * Persistent two-way live voice session (server VAD, barge-in, reconnect).
 * Browser auth: ephemeral client secret only (never the voice API key).
 */

import type { SharedAudioOutput } from "../voice/audio-output.ts";
import { LiveSpeakerGain, readStoredVolume } from "./speaker-gain.ts";
import {
  REALTIME_ENDPOINT,
  REALTIME_SAMPLE_RATE,
} from "../voice/realtime-session.ts";
import { resolveXaiVoiceId } from "../voice/voices.ts";
import { formatMicCaptureError, formatVoiceClientError } from "../voice/errors.ts";
import { OLLAMA_UNREACHABLE, runOllamaConductor } from "../voice/ollama-conductor.ts";
import { getVoiceMode } from "../voice/mode-store.ts";
import { voiceSessionInstructions, type VoiceProfileInput } from "./session-instructions.ts";
import { voiceModeLabel, type VoiceRoutingMode } from "../voice/mode.ts";
import { sanitizeVoiceTranscript } from "../voice/limits.ts";
import {
  phaseToLabel,
  phaseToUiAttr,
  throttleLiveLevel,
  type LiveVoicePhase,
  type LiveVoicePublicState,
} from "./types.ts";
import {
  allowCancel,
  beginFlight,
  createCancelBudget,
  createFlightGate,
  createTranscriptDedupe,
  endFlight,
  isCurrentFlight,
  MAX_RECONNECT_ATTEMPTS,
  nextReconnectDelayMs,
  shouldAcceptTranscript,
  type CancelBudget,
  type FlightGate,
  type TranscriptDedupe,
} from "./spam-guard.ts";
import { decideBargeInCutoff } from "./barge-in.ts";
import { bufferToBase64, LiveMicStream } from "./mic-stream.ts";
import { createLivePlayback, type LivePlayback } from "./playback.ts";
import {
  isLiveVoiceOccupied,
  OVERLAY_MIC_BUSY_MESSAGE,
  setLiveVoiceOccupied,
} from "./occupancy.ts";
import { probeMicrophone } from "./mic-probe.ts";
import {
  ConnectTimeoutError,
  isAbortError,
  MIC_PROBE_TIMEOUT_MS,
  MIC_START_TIMEOUT_MS,
  MINT_TIMEOUT_MS,
  WS_OPEN_TIMEOUT_MS,
  withTimeout,
} from "./connect-timeout.ts";

export type MintSecretResult =
  | { ok: true; value: string; expiresAt: number }
  | { ok: false; error: string };

export type LiveSessionHandlers = {
  onState?: (state: LiveVoicePublicState) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
};

export type LiveSessionDeps = {
  mintSecret: (signal?: AbortSignal) => Promise<MintSecretResult>;
  /** True when overlay/PTT mic is already open. */
  isOverlayMicOpen?: () => boolean;
  getMode?: () => VoiceRoutingMode;
  getVoiceId?: () => string;
  /** Active chat personality and selected character. Absent keeps the previous default prompts. */
  getVoiceProfile?: () => Pick<VoiceProfileInput, "personalityId" | "customPersonality" | "characterId" | "modeInstruction"> | null;
  output?: SharedAudioOutput; // unused for playback; kept for API compat
  speaker?: LiveSpeakerGain;
  socketFactory?: (url: string, protocols: string[]) => WsLike;
  runConductor?: typeof runOllamaConductor;
  now?: () => number;
  /** Injected mic preflight (tests / headless). */
  probeMic?: () => Promise<{ ok: true; stream?: MediaStream } | { ok: false; error: string }>;
  /** Skip opening getUserMedia (tests driving WS only). */
  skipMic?: boolean;
};

type WsLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (type: string, listener: (event: MessageEvent | Event) => void) => void;
};

function defaultSocketFactory(url: string, protocols: string[]): WsLike {
  return new WebSocket(url, protocols) as unknown as WsLike;
}

const INTERRUPTED_FLASH_MS = 350;

export class LiveVoiceSession {
  private handlers: LiveSessionHandlers;
  private deps: Required<
    Pick<LiveSessionDeps, "mintSecret">
  > &
    LiveSessionDeps;
  private phase: LiveVoicePhase = "off";
  private preopenedMic?: MediaStream;
  private error: string | null = null;
  private muted = false;
  private level = 0;
  private levelAt = 0;
  private flight: FlightGate = createFlightGate();
  private cancelBudget: CancelBudget = createCancelBudget();
  private dedupe: TranscriptDedupe = createTranscriptDedupe();
  private ws: WsLike | null = null;
  private mic: LiveMicStream | null = null;
  private playback: LivePlayback;
  private intentionalClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private interruptTimer: ReturnType<typeof setTimeout> | null = null;
  private mintAbort: AbortController | null = null;
  private connectAbort: AbortController | null = null;
  private assistantPlaying = false;
  private speakingStartedAtMs: number | null = null;
  private pendingAssistantText = "";
  private lastUserTranscript = "";
  private open = false;
  private generation = 0;

  constructor(handlers: LiveSessionHandlers = {}, deps: LiveSessionDeps) {
    this.handlers = handlers;
    this.deps = deps;
    this.playback = createLivePlayback(
      deps.speaker ??
        new LiveSpeakerGain(
          readStoredVolume(typeof localStorage === "undefined" ? null : localStorage),
        ),
    );
  }

  get state(): LiveVoicePublicState {
    return this.buildState();
  }

  get isActive() {
    return this.phase !== "off" && this.phase !== "error";
  }

  private buildState(): LiveVoicePublicState {
    const mode = this.deps.getMode?.() ?? getVoiceMode();
    return {
      phase: this.phase,
      uiAttr: phaseToUiAttr(this.phase, this.muted),
      label: phaseToLabel(this.phase, this.muted),
      level: this.level,
      muted: this.muted,
      error: this.error,
      active: this.phase !== "off",
      modeBadge: voiceModeLabel(mode),
    };
  }

  private emit() {
    this.handlers.onState?.(this.buildState());
  }

  private setPhase(phase: LiveVoicePhase) {
    this.phase = phase;
    if (phase === "off" || phase === "error") {
      setLiveVoiceOccupied(false);
    } else {
      setLiveVoiceOccupied(true);
    }
    this.emit();
  }

  private fail(message: string) {
    this.error = message;
    this.handlers.onError?.(message);
    this.teardownMedia(false);
    this.setPhase("error");
    // Settle to off so the button can restart; keep error text visible via handlers.
    setTimeout(() => {
      if (this.phase === "error") {
        this.setPhase("off");
      }
    }, 50);
  }

  async start() {
    const ticket = beginFlight(this.flight);
    if (!ticket) {
      this.handlers.onNotice?.("Live voice is already starting.");
      return;
    }
    try {
      if (isLiveVoiceOccupied() && this.phase !== "off" && this.phase !== "error") {
        this.handlers.onNotice?.("Live voice is already on.");
        return;
      }
      if (this.deps.isOverlayMicOpen?.()) {
        this.error = OVERLAY_MIC_BUSY_MESSAGE;
        this.handlers.onError?.(OVERLAY_MIC_BUSY_MESSAGE);
        this.emit();
        return;
      }
      this.intentionalClose = false;
      this.error = null;
      this.reconnectAttempt = 0;
      this.generation = ticket.generation;
      this.connectAbort?.abort();
      const connectAbort = new AbortController();
      this.connectAbort = connectAbort;
      this.setPhase("connecting");
      let probe;
      try {
        probe = await withTimeout(
          (this.deps.probeMic ?? probeMicrophone)(),
          MIC_PROBE_TIMEOUT_MS,
          "mic",
          "Microphone did not respond in time. Check permissions or connect a mic, then try again.",
          connectAbort.signal,
        );
      } catch (caught) {
        if (this.intentionalClose || isAbortError(caught) || connectAbort.signal.aborted) return;
        if (caught instanceof ConnectTimeoutError) {
          this.fail(caught.message);
          return;
        }
        this.fail(formatMicCaptureError(caught) || formatVoiceClientError(caught));
        return;
      }
      if (this.intentionalClose || connectAbort.signal.aborted) return;
      if (!probe.ok) {
        this.fail(probe.error);
        return;
      }
      this.preopenedMic = probe.stream;
      await this.connectAndCapture(ticket.generation, connectAbort.signal);
    } catch (caught) {
      if (this.intentionalClose || isAbortError(caught)) return;
      if (caught instanceof ConnectTimeoutError) {
        this.fail(caught.message);
        return;
      }
      this.fail(formatVoiceClientError(caught));
    } finally {
      endFlight(this.flight, ticket.generation);
    }
  }

  /** Mic button: first tap starts; while connecting cancels; later taps toggle mute. */
  async pressMic() {
    if (this.phase === "connecting" || this.phase === "reconnecting") {
      this.end("Live voice start canceled.");
      return;
    }
    if (this.phase === "off" || this.phase === "error") {
      await this.start();
      return;
    }
    this.toggleMute();
  }

  /** @deprecated use pressMic / end — kept for tests */
  async toggle() {
    await this.pressMic();
  }

  get lastTranscript() {
    return this.lastUserTranscript;
  }

  get speaker() {
    return this.playback.speaker;
  }

  /** Typed Ask Anything → realtime input_text + response.create when live. */
  sendText(text: string) {
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed) return false;
    if (!this.open) return false;
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: trimmed }],
      },
    });
    this.send({ type: "response.create" });
    this.lastUserTranscript = trimmed;
    this.handlers.onUserTranscript?.(trimmed);
    this.setPhase("thinking");
    return true;
  }

  /**
   * Attach image context. Native input_image is unsupported on grok-voice (ignored);
   * returns { native: false } so UI can run chat/vision fallback.
   */
  attachImageContext(_jpegBase64: string, caption?: string): { native: boolean; note: string } {
    void _jpegBase64;
    if (caption?.trim()) {
      this.sendText(`(Attached image) ${caption.trim()}`);
    }
    return {
      native: false,
      note: "Realtime voice does not accept images natively; using chat vision fallback.",
    };
  }

  end(notice?: string) {
    this.intentionalClose = true;
    this.generation += 1;
    this.clearReconnect();
    this.connectAbort?.abort();
    this.connectAbort = null;
    this.mintAbort?.abort();
    this.mintAbort = null;
    this.teardownMedia(true);
    try {
      this.playback.speaker.dispose();
    } catch {
      /* ignore */
    }
    this.muted = false;
    this.error = null;
    this.level = 0;
    this.open = false;
    this.setPhase("off");
    if (notice) this.handlers.onNotice?.(notice);
  }

  setMuted(next: boolean) {
    if (this.phase === "off") return;
    this.muted = next;
    this.mic?.setMuted(next);
    this.emit();
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownMedia(closeWs: boolean) {
    this.preopenedMic?.getTracks().forEach((track) => track.stop());
    this.preopenedMic = undefined;
    if (this.interruptTimer) {
      clearTimeout(this.interruptTimer);
      this.interruptTimer = null;
    }
    this.playback.interrupt();
    this.assistantPlaying = false;
    this.speakingStartedAtMs = null;
    this.mic?.stop();
    this.mic = null;
    if (closeWs) {
      try {
        this.ws?.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
      this.open = false;
    }
  }

  private send(payload: unknown) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(payload));
  }

  private async connectAndCapture(generation: number, outerSignal?: AbortSignal) {
    this.mintAbort?.abort();
    const mintAbort = new AbortController();
    this.mintAbort = mintAbort;
    const onOuter = () => mintAbort.abort();
    outerSignal?.addEventListener("abort", onOuter, { once: true });
    if (outerSignal?.aborted || this.intentionalClose) {
      outerSignal?.removeEventListener("abort", onOuter);
      return;
    }
    let secret: MintSecretResult;
    try {
      secret = await withTimeout(
        this.deps.mintSecret(mintAbort.signal),
        MINT_TIMEOUT_MS,
        "mint",
        "Voice secret mint timed out. Check the network, then try again.",
        mintAbort.signal,
      );
    } catch (caught) {
      outerSignal?.removeEventListener("abort", onOuter);
      if (mintAbort.signal.aborted || this.intentionalClose || isAbortError(caught)) {
        return;
      }
      if (caught instanceof ConnectTimeoutError) {
        this.fail(caught.message);
        return;
      }
      this.fail(formatVoiceClientError(caught));
      return;
    }
    outerSignal?.removeEventListener("abort", onOuter);
    if (mintAbort.signal.aborted || this.intentionalClose || outerSignal?.aborted) return;
    if (!secret.ok) {
      this.fail(secret.error || "Voice secret could not be minted.");
      return;
    }

    const factory = this.deps.socketFactory ?? defaultSocketFactory;
    const ws = factory(REALTIME_ENDPOINT, [`xai-client-secret.${secret.value}`]);
    this.ws = ws;

    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const onOpen = () => {
            this.open = true;
            resolve();
          };
          const onError = () => reject(new Error("Live voice connection failed."));
          const onAbort = () => reject(Object.assign(new Error("Live voice start was canceled."), { name: "AbortError" }));
          ws.addEventListener("open", onOpen);
          ws.addEventListener("error", onError);
          ws.addEventListener("message", (event) => this.onMessage(event as MessageEvent));
          ws.addEventListener("close", () => this.onSocketClose());
          if (outerSignal?.aborted || mintAbort.signal.aborted) onAbort();
          else {
            outerSignal?.addEventListener("abort", onAbort, { once: true });
            mintAbort.signal.addEventListener("abort", onAbort, { once: true });
          }
        }),
        WS_OPEN_TIMEOUT_MS,
        "ws",
        "Live voice did not connect in time. Check the network, then try again.",
        outerSignal ?? mintAbort.signal,
      );
    } catch (caught) {
      if (this.intentionalClose || isAbortError(caught) || mintAbort.signal.aborted || outerSignal?.aborted) {
        this.teardownMedia(true);
        return;
      }
      if (caught instanceof ConnectTimeoutError) {
        this.fail(caught.message);
        return;
      }
      this.fail(formatVoiceClientError(caught));
      return;
    }

    if (this.intentionalClose || mintAbort.signal.aborted || outerSignal?.aborted) {
      this.teardownMedia(true);
      return;
    }

    const voiceId = resolveXaiVoiceId(this.deps.getVoiceId?.());
    const mode = this.deps.getMode?.() ?? getVoiceMode();
    const profile = this.deps.getVoiceProfile?.() ?? null;
    const built = profile
      ? voiceSessionInstructions({ mode, ...profile })
      : null;
    this.send({
      type: "session.update",
      session: {
        voice: voiceId,
        instructions: built
          ? built.instructions
          : mode === "orchestrator"
            ? "You are a silent speech-to-text capture helper. Do not speak replies; only transcribe the user."
            : "You are a helpful voice assistant. Keep spoken replies concise.",
        turn_detection: { type: "server_vad" },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
            transcription: {},
          },
          output: { format: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE } },
        },
      },
    });

    if (!this.deps.skipMic) {
      this.mic = new LiveMicStream(
        {
          onPcm16: (pcm) => {
            if (!this.open || this.muted) return;
            this.send({ type: "input_audio_buffer.append", audio: bufferToBase64(pcm) });
          },
          onLevel: (level) => {
            const now = this.deps.now?.() ?? Date.now();
            const t = throttleLiveLevel(this.levelAt, now, level);
            if (t.emit) {
              this.level = t.value;
              this.levelAt = t.at;
              this.emit();
            }
          },
          onError: (err) => {
            const mic = formatMicCaptureError(err);
            this.fail(mic || formatVoiceClientError(err));
          },
        },
        { sampleRate: REALTIME_SAMPLE_RATE },
      );

      try {
        await withTimeout(
          this.mic.start(this.preopenedMic),
          MIC_START_TIMEOUT_MS,
          "mic-start",
          "Microphone start timed out. Check permissions or connect a mic, then try again.",
          outerSignal ?? this.connectAbort?.signal ?? null,
        );
        this.preopenedMic = undefined;
      } catch (err) {
        this.preopenedMic?.getTracks().forEach((track) => track.stop());
        this.preopenedMic = undefined;
        if (this.intentionalClose || isAbortError(err) || outerSignal?.aborted) {
          this.teardownMedia(true);
          return;
        }
        if (err instanceof ConnectTimeoutError) {
          this.fail(err.message);
          return;
        }
        const mic = formatMicCaptureError(err);
        this.fail(mic || formatVoiceClientError(err));
        return;
      }
    }

    this.reconnectAttempt = 0;
    this.setPhase(this.muted ? "muted" : "listening");
  }

  private onSocketClose() {
    this.open = false;
    if (this.intentionalClose) {
      this.teardownMedia(false);
      return;
    }
    // Unexpected drop — reconnect with backoff up to 3 times.
    this.playback.interrupt();
    this.mic?.stop();
    this.mic = null;
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.fail("Live voice connection dropped after 3 reconnect attempts. Press the speak button to try again.");
      return;
    }
    this.reconnectAttempt += 1;
    const delay = nextReconnectDelayMs(this.reconnectAttempt);
    this.setPhase("reconnecting");
    this.handlers.onNotice?.(
      `Live voice connection dropped. Reconnecting (${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})…`,
    );
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      void this.reconnectNow();
    }, delay);
  }

  private async reconnectNow() {
    if (this.intentionalClose) return;
    const ticket = beginFlight(this.flight);
    if (!ticket) return;
    try {
      this.connectAbort?.abort();
      const connectAbort = new AbortController();
      this.connectAbort = connectAbort;
      this.setPhase("connecting");
      await this.connectAndCapture(ticket.generation, connectAbort.signal);
    } catch (caught) {
      if (this.intentionalClose || isAbortError(caught)) return;
      if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        this.fail(formatVoiceClientError(caught));
      } else {
        this.onSocketClose();
      }
    } finally {
      endFlight(this.flight, ticket.generation);
    }
  }

  private bargeIn() {
    const now = this.deps.now?.() ?? Date.now();
    const decision = decideBargeInCutoff({
      assistantPlaying: this.assistantPlaying || this.playback.isPlaying,
      speakingStartedAtMs: this.speakingStartedAtMs,
      nowMs: now,
      cancelAllowed: allowCancel(this.cancelBudget, now),
    });
    if (!decision.cut) return;
    this.playback.interrupt();
    if (decision.sendCancel) this.send({ type: "response.cancel" });
    this.assistantPlaying = false;
    this.speakingStartedAtMs = null;
    this.pendingAssistantText = "";
    this.setPhase("interrupted");
    if (this.interruptTimer) clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => {
      if (this.phase === "interrupted") this.setPhase(this.muted ? "muted" : "user_speaking");
    }, INTERRUPTED_FLASH_MS);
  }

  private onMessage(event: MessageEvent) {
    const raw = typeof event.data === "string" ? event.data : null;
    if (!raw) return;
    let msg: {
      type?: string;
      transcript?: string;
      delta?: string;
      text?: string;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    const type = msg.type || "";
    if (type === "error") {
      this.handlers.onError?.(msg.error?.message || "Live voice realtime error.");
      return;
    }
    if (type === "input_audio_buffer.speech_started") {
      this.bargeIn();
      if (this.phase !== "interrupted") this.setPhase(this.muted ? "muted" : "user_speaking");
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      if (this.phase === "user_speaking" || this.phase === "interrupted") {
        this.setPhase("thinking");
      }
      return;
    }
    if (
      type === "conversation.item.input_audio_transcription.delta" ||
      type === "conversation.item.input_audio_transcription.partial" ||
      type === "conversation.item.input_audio_transcription.updated" ||
      type === "input_audio_transcription.delta"
    ) {
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = (msg.transcript || "").trim();
      void this.handleUserTranscript(text);
      return;
    }
    if (type === "response.output_audio.delta" || type === "response.audio.delta") {
      if (msg.delta) {
        this.assistantPlaying = true;
        if (this.speakingStartedAtMs == null) this.speakingStartedAtMs = this.deps.now?.() ?? Date.now();
        this.setPhase("assistant_speaking");
        void this.playback.playDeltaBase64(msg.delta).catch(() => undefined);
      }
      return;
    }
    if (
      type === "response.output_audio_transcript.delta" ||
      type === "response.audio_transcript.delta" ||
      type === "response.output_text.delta"
    ) {
      const piece = msg.delta || msg.text || "";
      if (piece) this.pendingAssistantText += piece;
      return;
    }
    if (
      type === "response.output_audio_transcript.done" ||
      type === "response.audio_transcript.done"
    ) {
      const text = (msg.transcript || this.pendingAssistantText || "").trim();
      this.pendingAssistantText = "";
      if (text) this.handlers.onAssistantTranscript?.(text);
      return;
    }
    if (type === "response.done") {
      const leftover = this.pendingAssistantText.trim();
      this.pendingAssistantText = "";
      if (leftover) this.handlers.onAssistantTranscript?.(leftover);
      this.assistantPlaying = false;
      this.speakingStartedAtMs = null;
      if (this.phase !== "off" && this.phase !== "error") {
        this.setPhase(this.muted ? "muted" : "listening");
      }
    }
  }

  private async handleUserTranscript(text: string) {
    const now = this.deps.now?.() ?? Date.now();
    if (!shouldAcceptTranscript(this.dedupe, text, now)) return;
    const sanitized = sanitizeVoiceTranscript(text);
    if (!sanitized.ok) return;
    const clean = sanitized.text;
    this.lastUserTranscript = clean;
    this.handlers.onUserTranscript?.(clean);

    const mode = this.deps.getMode?.() ?? getVoiceMode();
    if (mode !== "orchestrator") {
      // Direct: native realtime model already answers; transcript only.
      this.setPhase(this.muted ? "muted" : "thinking");
      return;
    }

    // Orchestrator: cancel any native audio, run local Ollama, speak via force_message.
    this.playback.interrupt();
    this.send({ type: "response.cancel" });
    this.setPhase("thinking");
    const conduct = this.deps.runConductor ?? runOllamaConductor;
    const result = await conduct(clean, {
      baseUrl:
        (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.base")) || undefined,
      model:
        (typeof localStorage !== "undefined" && localStorage.getItem("amcos.ollama.model")) || undefined,
    });
    if (this.intentionalClose || this.phase === "off") return;
    if (!result.ok) {
      this.handlers.onNotice?.(result.error || OLLAMA_UNREACHABLE);
      // Keep session alive; send nothing to a cloud model.
      this.setPhase(this.muted ? "muted" : "listening");
      return;
    }
    this.handlers.onAssistantTranscript?.(result.text);
    this.speakForce(result.text);
  }

  /** Speak orchestrator text over the same realtime output (force_message). */
  speakForce(text: string) {
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed || !this.open) return;
    this.playback.interrupt();
    this.send({ type: "response.cancel" });
    this.send({
      type: "conversation.item.create",
      item: {
        type: "force_message",
        role: "assistant",
        interruptible: true,
        content: [{ type: "output_text", text: trimmed }],
      },
    });
    this.setPhase("assistant_speaking");
  }
}

/** Pure reducer helpers exported for unit tests. */
export function reduceLivePhaseAfterEvent(
  phase: LiveVoicePhase,
  event: "speech_started" | "speech_stopped" | "audio_delta" | "response_done" | "barge_cut",
  muted = false,
): LiveVoicePhase {
  if (phase === "off" || phase === "error") return phase;
  switch (event) {
    case "speech_started":
      return muted ? "muted" : "user_speaking";
    case "barge_cut":
      return "interrupted";
    case "speech_stopped":
      return "thinking";
    case "audio_delta":
      return "assistant_speaking";
    case "response_done":
      return muted ? "muted" : "listening";
    default:
      return phase;
  }
}
