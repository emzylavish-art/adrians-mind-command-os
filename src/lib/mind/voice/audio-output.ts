/** Shared speaker path for Direct and Orchestrator voice replies. */

export type PcmFormat = { sampleRate: number; channels?: number };

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export class SharedAudioOutput {
  private ctx: AudioContext | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private stopped = false;
  private playing = false;
  private onEnded: (() => void) | null = null;
  private onLevel: ((level: number) => void) | null = null;

  get isPlaying() {
    return this.playing;
  }

  setEndedListener(listener: (() => void) | null) {
    this.onEnded = listener;
  }

  setLevelListener(listener: ((level: number) => void) | null) {
    this.onLevel = listener;
  }

  private ensureCtx(sampleRate: number) {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("This browser has no audio output.");
    this.ctx = new Ctx({ sampleRate });
    return this.ctx;
  }

  /** Stop buffered playback immediately. */
  stop() {
    this.stopped = true;
    this.playing = false;
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }

  async playPcm16Base64(b64: string, format: PcmFormat = { sampleRate: 24000 }) {
    const bytes = decodeBase64(b64);
    return this.playPcm16(bytes, format);
  }

  async playPcm16(bytes: Uint8Array, format: PcmFormat = { sampleRate: 24000 }) {
    this.stopped = false;
    const sampleRate = format.sampleRate || 24000;
    const ctx = this.ensureCtx(sampleRate);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    const aligned = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
    const samples = new Int16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 2));
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    const channel = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]! / 32768;
      channel[i] = v;
      peak = Math.max(peak, Math.abs(v));
    }
    this.onLevel?.(Math.min(1, peak * 1.4));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.sources.push(source);
    this.playing = true;
    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources = this.sources.filter((item) => item !== source);
        if (this.sources.length === 0) {
          this.playing = false;
          this.onEnded?.();
        }
        resolve();
      };
      try {
        if (this.stopped) {
          resolve();
          return;
        }
        source.start();
      } catch {
        resolve();
      }
    });
  }

  async playMpegBase64(b64: string) {
    this.stopped = false;
    const bytes = decodeBase64(b64);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.playing = true;
    await new Promise<void>((resolve) => {
      const finish = () => {
        this.playing = false;
        URL.revokeObjectURL(url);
        this.onEnded?.();
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      (this as unknown as { _htmlAudio?: HTMLAudioElement })._htmlAudio = audio;
      audio.play().catch(finish);
    });
  }

  stopHtmlAudio() {
    const audio = (this as unknown as { _htmlAudio?: HTMLAudioElement })._htmlAudio;
    if (audio) {
      try {
        audio.pause();
        audio.src = "";
      } catch {
        /* ignore */
      }
      (this as unknown as { _htmlAudio?: HTMLAudioElement })._htmlAudio = undefined;
    }
  }

  /** Hard cut used for barge-in / mic stop. */
  interrupt() {
    this.stop();
    this.stopHtmlAudio();
  }
}

export const sharedAudioOutput = new SharedAudioOutput();
