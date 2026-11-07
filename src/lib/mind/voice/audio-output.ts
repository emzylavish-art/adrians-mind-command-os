/** Shared speaker path for Direct, Orchestrator, and message-level Speak. */

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
  private htmlAudio: HTMLAudioElement | null = null;
  private htmlFinish: (() => void) | null = null;

  get isPlaying() {
    return this.playing;
  }

  setEndedListener(listener: (() => void) | null) {
    this.onEnded = listener;
  }

  private ensureCtx(sampleRate: number) {
    if (this.ctx && this.ctx.state !== "closed") return this.ctx;
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("This browser has no audio output.");
    this.ctx = new Ctx({ sampleRate });
    return this.ctx;
  }

  /** Stop buffered PCM playback immediately. */
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
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
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
    this.htmlAudio = audio;
    this.playing = true;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.playing = false;
        if (this.htmlAudio === audio) this.htmlAudio = null;
        this.htmlFinish = null;
        URL.revokeObjectURL(url);
        this.onEnded?.();
        resolve();
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.playing = false;
        if (this.htmlAudio === audio) this.htmlAudio = null;
        this.htmlFinish = null;
        URL.revokeObjectURL(url);
        reject(err);
      };
      this.htmlFinish = finish;
      if (this.stopped) {
        finish();
        return;
      }
      audio.onended = finish;
      audio.onerror = () => fail(new Error("The browser blocked playback."));
      const played = audio.play();
      if (played && typeof (played as Promise<void>).catch === "function") {
        void (played as Promise<void>).catch((err) => fail(err instanceof Error ? err : new Error("The browser blocked playback.")));
      }
    });
  }

  stopHtmlAudio() {
    const audio = this.htmlAudio;
    const finish = this.htmlFinish;
    if (audio) {
      try {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch {
        /* ignore */
      }
      this.htmlAudio = null;
    }
    // Always resolve a pending playMpeg await so Speaking can clear.
    finish?.();
    this.htmlFinish = null;
  }

  /** Hard cut used for barge-in / mic stop / Speak cancel. */
  interrupt() {
    this.stop();
    this.stopHtmlAudio();
    this.playing = false;
  }
}

export const sharedAudioOutput = new SharedAudioOutput();
