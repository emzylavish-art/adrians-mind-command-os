/** Always-on mic capture → pcm16 @ session rate, with mute (stop appending, keep tracks). */

import { rmsFromFloatSamples } from "../voice/level.ts";
import type { MicPermissionState } from "../voice/speak-state/events.ts";
import { LEVEL_INTERVAL_MS } from "../voice/speak-state/signal.ts";
import type { SpeakMicSink } from "../voice/speak-state/sink.ts";

export type MicStreamHandlers = {
  onPcm16?: (pcm: ArrayBuffer) => void;
  onLevel?: (level: number) => void;
  onError?: (err: unknown) => void;
};

export type MicStreamOptions = {
  sampleRate?: number;
  getUserMediaImpl?: typeof navigator.mediaDevices.getUserMedia;
  /** Speak-state sink for permission, device changes, and ~50 Hz levels. */
  speakState?: SpeakMicSink;
};

/** Map a getUserMedia failure onto the speak-state permission enum. Other failures are not permission changes. */
export function micPermissionFromError(caught: unknown): MicPermissionState | null {
  const name =
    caught && typeof caught === "object" && "name" in caught
      ? String((caught as { name?: string }).name || "")
      : "";
  const message = caught instanceof Error ? caught.message : String(caught || "");
  if (name === "NotAllowedError" || /permission|notallowed|denied/i.test(message)) return "denied";
  return null;
}

export function readAudioDeviceId(stream: {
  getAudioTracks?: () => Array<{ getSettings?: () => { deviceId?: string } }>;
}): string | null {
  const id = stream.getAudioTracks?.()[0]?.getSettings?.().deviceId;
  return id ? String(id) : null;
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
  private muted = false;
  private running = false;
  private handlers: MicStreamHandlers;
  private sampleRate: number;
  private getUserMediaImpl?: typeof navigator.mediaDevices.getUserMedia;
  private speakState?: SpeakMicSink;
  private stopping = false;
  private levelPump: ReturnType<typeof setInterval> | null = null;
  private stopWatch: (() => void) | null = null;
  /** Bound rolling PCM append bytes to avoid unbounded growth (30-min sessions). */
  private appendedBytes = 0;
  static readonly MAX_APPENDED_BYTES_HINT = 24_000 * 2 * 60; // ~1 min of pcm16 — reset counter only

  constructor(handlers: MicStreamHandlers = {}, options: MicStreamOptions = {}) {
    this.handlers = handlers;
    this.sampleRate = options.sampleRate ?? 24_000;
    this.getUserMediaImpl = options.getUserMediaImpl;
    this.speakState = options.speakState;
  }

  get deviceId(): string | null {
    return this.media ? readAudioDeviceId(this.media) : null;
  }

  get isTrackLive(): boolean {
    const track = this.media?.getAudioTracks()[0];
    return Boolean(track && track.readyState === "live");
  }

  get isRunning() {
    return this.running;
  }

  get isMuted() {
    return this.muted;
  }

  setMuted(next: boolean) {
    this.muted = next;
  }

  async start() {
    if (this.running) return;
    const gum =
      this.getUserMediaImpl ??
      (typeof navigator !== "undefined"
        ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
        : undefined);
    if (!gum)
      throw Object.assign(new Error("No microphone API in this environment."), {
        name: "NotFoundError",
      });
    if (this.speakState && this.speakState.permission !== "granted") {
      this.speakState.setPermission("prompt", this.speakState.deviceId);
    }
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
      const perm = micPermissionFromError(err);
      if (perm) this.speakState?.setPermission(perm, null);
      this.handlers.onError?.(err);
      throw err;
    }
    this.media = media;
    try {
      await this.openGraph(media);
    } catch (err) {
      this.stopping = true;
      media.getTracks().forEach((track) => track.stop());
      this.media = null;
      this.audioCtx = null;
      this.processor = null;
      this.source = null;
      this.stopping = false;
      this.speakState?.setMicOpen(false);
      this.handlers.onError?.(err);
      throw err;
    }
  }

  private async openGraph(media: MediaStream) {
    const deviceId = readAudioDeviceId(media);
    this.speakState?.setPermission("granted", deviceId);
    this.watchTrack(media);
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
      this.speakState?.pushLevel(level);
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
    const silent = this.audioCtx.createGain();
    silent.gain.value = 0;
    this.processor.connect(silent);
    silent.connect(this.audioCtx.destination);
    this.running = true;
    this.speakState?.setMicOpen(true);
    this.armLevelPump();
    this.armDeviceWatch();
  }

  stop() {
    this.stopping = true;
    this.running = false;
    this.muted = false;
    this.appendedBytes = 0;
    this.clearLevelPump();
    this.stopWatch?.();
    this.stopWatch = null;
    this.speakState?.setMicOpen(false);
    this.handlers.onLevel?.(0);
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.source = null;
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = null;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.stopping = false;
  }

  private watchTrack(media: MediaStream) {
    const track = media.getAudioTracks()[0];
    if (!track?.addEventListener) return;
    track.addEventListener("ended", () => {
      if (this.stopping || !this.running) return;
      const perm = this.speakState?.permission ?? "granted";
      this.speakState?.setPermission(perm === "denied" ? "denied" : "granted", null);
    });
  }

  private armLevelPump() {
    this.clearLevelPump();
    if (typeof setInterval !== "function") return;
    const timer = setInterval(() => {
      if (!this.running || this.stopping) return;
      this.speakState?.pumpLevel();
    }, LEVEL_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.levelPump = timer;
  }

  private clearLevelPump() {
    if (this.levelPump) clearInterval(this.levelPump);
    this.levelPump = null;
  }

  private armDeviceWatch() {
    this.stopWatch?.();
    const stops: Array<() => void> = [];
    const perms = typeof navigator !== "undefined" ? navigator.permissions : undefined;
    if (perms?.query) {
      let status: PermissionStatus | null = null;
      const onChange = () => {
        if (this.stopping || !this.running) return;
        if (status?.state === "denied") this.speakState?.setPermission("denied", this.deviceId);
      };
      void perms
        .query({ name: "microphone" as PermissionName })
        .then((next) => {
          if (this.stopping) return;
          status = next;
          next.addEventListener?.("change", onChange);
        })
        .catch(() => undefined);
      stops.push(() => status?.removeEventListener?.("change", onChange));
    }
    const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (devices?.addEventListener) {
      const onDevices = () => {
        if (this.stopping || !this.running) return;
        if (!this.isTrackLive) {
          const perm = this.speakState?.permission ?? "granted";
          this.speakState?.setPermission(perm === "denied" ? "denied" : "granted", null);
          return;
        }
        const id = this.deviceId;
        if (id && this.speakState && id !== this.speakState.deviceId) {
          this.speakState.setPermission("granted", id);
        }
      };
      devices.addEventListener("devicechange", onDevices);
      stops.push(() => devices.removeEventListener("devicechange", onDevices));
    }
    this.stopWatch = () => {
      for (const stop of stops) stop();
    };
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
