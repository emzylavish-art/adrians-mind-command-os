/** Always-on mic capture → pcm16 @ session rate, with mute + optional screen-audio mix. */

import { rmsFromFloatSamples } from "../voice/level.ts";

export type MicStreamHandlers = {
  onPcm16?: (pcm: ArrayBuffer) => void;
  onLevel?: (level: number) => void;
  onError?: (err: unknown) => void;
};

export type MicStreamOptions = {
  sampleRate?: number;
  getUserMediaImpl?: typeof navigator.mediaDevices.getUserMedia;
};

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = Math.floor(i * ratio);
    out[i] = input[idx] ?? 0;
  }
  return out;
}

export class LiveMicStream {
  private media: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silent: GainNode | null = null;
  private displayMedia: MediaStream | null = null;
  private displaySource: MediaStreamAudioSourceNode | null = null;
  private displayGain: GainNode | null = null;
  private screenMixEnabled = true;
  private muted = false;
  private running = false;
  private handlers: MicStreamHandlers;
  private sampleRate: number;
  private getUserMediaImpl?: typeof navigator.mediaDevices.getUserMedia;
  /** Bound rolling PCM append bytes to avoid unbounded growth (30-min sessions). */
  private appendedBytes = 0;
  static readonly MAX_APPENDED_BYTES_HINT = 24_000 * 2 * 60; // ~1 min of pcm16 — reset counter only

  constructor(handlers: MicStreamHandlers = {}, options: MicStreamOptions = {}) {
    this.handlers = handlers;
    this.sampleRate = options.sampleRate ?? 24_000;
    this.getUserMediaImpl = options.getUserMediaImpl;
  }

  get isRunning() {
    return this.running;
  }

  get isMuted() {
    return this.muted;
  }

  get hasDisplayAudio() {
    return Boolean(this.displayMedia?.getAudioTracks().some((t) => t.readyState === "live"));
  }

  get isScreenMixEnabled() {
    return this.screenMixEnabled;
  }

  /** True when a live display track is connected into the mic graph. */
  get isMixingScreenAudio() {
    return this.running && this.screenMixEnabled && this.hasDisplayAudio && Boolean(this.displaySource);
  }

  setMuted(next: boolean) {
    this.muted = next;
  }

  async start() {
    if (this.running) return;
    const gum =
      this.getUserMediaImpl ??
      (typeof navigator !== "undefined" ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) : undefined);
    if (!gum) throw Object.assign(new Error("No microphone API in this environment."), { name: "NotFoundError" });
    let media: MediaStream;
    try {
      media = await gum({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.handlers.onError?.(err);
      throw err;
    }
    this.media = media;
    const Ctx =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("This browser has no AudioContext.");
    this.audioCtx = new Ctx();
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume().catch(() => undefined);
    }
    this.source = this.audioCtx.createMediaStreamSource(media);
    // ScriptProcessor fallback (AudioWorklet needs a separate module URL).
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (ev) => {
      if (!this.running) return;
      const input = ev.inputBuffer.getChannelData(0);
      const level = rmsFromFloatSamples(input);
      this.handlers.onLevel?.(level);
      if (this.muted) return;
      const fromRate = this.audioCtx?.sampleRate ?? this.sampleRate;
      const down = downsample(input, fromRate, this.sampleRate);
      const pcm = floatTo16BitPCM(down);
      this.appendedBytes += pcm.byteLength;
      // Cap accounting so a 30-minute session does not grow counters unboundedly in tests/metrics.
      if (this.appendedBytes > LiveMicStream.MAX_APPENDED_BYTES_HINT * 30) this.appendedBytes = 0;
      this.handlers.onPcm16?.(pcm);
    };
    this.source.connect(this.processor);
    // Keep processor alive without audible feedback loop.
    this.silent = this.audioCtx.createGain();
    this.silent.gain.value = 0;
    this.processor.connect(this.silent);
    this.silent.connect(this.audioCtx.destination);
    this.running = true;
    // Re-attach any pending display stream now that the graph exists.
    if (this.displayMedia) this.wireDisplaySource();
  }

  /**
   * Attach tab/system audio from getDisplayMedia into the same WebAudio graph
   * that feeds realtime PCM. Tracks are not stopped here — caller owns lifecycle.
   */
  attachDisplayAudio(stream: MediaStream) {
    this.detachDisplayAudio({ stopTracks: false });
    this.displayMedia = stream;
    if (this.running && this.audioCtx && this.processor) {
      this.wireDisplaySource();
    }
  }

  /** Enable/disable mixing display audio without releasing the display stream. */
  setScreenMixEnabled(enabled: boolean) {
    this.screenMixEnabled = enabled;
    if (!this.displayGain) {
      if (enabled && this.displayMedia && this.running) this.wireDisplaySource();
      return;
    }
    this.displayGain.gain.value = enabled ? 1 : 0;
  }

  detachDisplayAudio(opts: { stopTracks?: boolean } = {}) {
    const stopTracks = opts.stopTracks ?? false;
    try {
      this.displaySource?.disconnect();
      this.displayGain?.disconnect();
    } catch {
      /* ignore */
    }
    this.displaySource = null;
    this.displayGain = null;
    if (stopTracks && this.displayMedia) {
      for (const t of this.displayMedia.getAudioTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
    }
    this.displayMedia = null;
  }

  private wireDisplaySource() {
    if (!this.audioCtx || !this.processor || !this.displayMedia) return;
    const live = this.displayMedia.getAudioTracks().filter((t) => t.readyState !== "ended");
    if (live.length === 0) return;
    try {
      this.displaySource?.disconnect();
      this.displayGain?.disconnect();
    } catch {
      /* ignore */
    }
    // Use only audio tracks so video does not confuse createMediaStreamSource.
    const audioOnly = new MediaStream(live);
    this.displaySource = this.audioCtx.createMediaStreamSource(audioOnly);
    this.displayGain = this.audioCtx.createGain();
    this.displayGain.gain.value = this.screenMixEnabled ? 1 : 0;
    // Sum into the same ScriptProcessor input as the mic (WebAudio mixes connections).
    this.displaySource.connect(this.displayGain);
    this.displayGain.connect(this.processor);
  }

  stop() {
    this.running = false;
    this.muted = false;
    this.appendedBytes = 0;
    this.handlers.onLevel?.(0);
    this.detachDisplayAudio({ stopTracks: false });
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.silent?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.source = null;
    this.silent = null;
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
