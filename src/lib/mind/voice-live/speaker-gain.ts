/**
 * Output volume / mute for live voice via GainNode.
 * Does not edit SharedAudioOutput; plays live deltas on a local graph and still
 * calls sharedAudioOutput.interrupt() so barge-in cuts message Speak too.
 */

import { sharedAudioOutput } from "../voice/audio-output.ts";
import { REALTIME_SAMPLE_RATE } from "../voice/realtime-session.ts";

export const SPEAKER_VOLUME_KEY = "amcos.voice.output.volume.v1";

export function readStoredVolume(storage?: Pick<Storage, "getItem"> | null): number {
  try {
    const raw = storage?.getItem(SPEAKER_VOLUME_KEY);
    const n = raw == null ? 1 : Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(1, n));
  } catch {
    return 1;
  }
}

export function writeStoredVolume(volume: number, storage?: Pick<Storage, "setItem"> | null): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
  try {
    storage?.setItem(SPEAKER_VOLUME_KEY, String(v));
  } catch {
    /* private mode */
  }
  return v;
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export class LiveSpeakerGain {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private volume = 1;
  private muted = false;
  private playing = false;
  private stopped = false;

  constructor(initialVolume = 1) {
    this.volume = Math.max(0, Math.min(1, initialVolume));
  }

  get isPlaying() {
    return this.playing;
  }

  get isMuted() {
    return this.muted;
  }

  get volumeLevel() {
    return this.volume;
  }

  private ensure() {
    if (this.ctx && this.ctx.state !== "closed" && this.gain) return { ctx: this.ctx, gain: this.gain };
    const Ctx =
      (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) throw new Error("This browser has no audio output.");
    this.ctx = new Ctx({ sampleRate: REALTIME_SAMPLE_RATE });
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;
    this.gain.connect(this.ctx.destination);
    return { ctx: this.ctx, gain: this.gain };
  }

  setMuted(next: boolean) {
    this.muted = next;
    if (this.gain) this.gain.gain.value = next ? 0 : this.volume;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(next: number, storage?: Pick<Storage, "setItem"> | null) {
    this.volume = writeStoredVolume(next, storage);
    if (this.gain && !this.muted) this.gain.gain.value = this.volume;
    return this.volume;
  }

  interrupt() {
    this.stopped = true;
    this.playing = false;
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* ignore */
      }
    }
    this.sources = [];
    sharedAudioOutput.interrupt();
  }

  async playPcm16Base64(b64: string) {
    if (!b64) return;
    this.stopped = false;
    const { ctx, gain } = this.ensure();
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    const bytes = decodeBase64(b64);
    const aligned = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
    const samples = new Int16Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.byteLength / 2));
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, REALTIME_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    this.sources.push(source);
    this.playing = true;
    await new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources = this.sources.filter((s) => s !== source);
        if (this.sources.length === 0) this.playing = false;
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

  dispose() {
    this.interrupt();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.gain = null;
  }
}
