/**
 * Queue #4 — WebAudio health tones (Dashboard Bot).
 *
 * Quiet by default (muted). Starts only after unlock() from a user gesture.
 * Healthy = soft hum, stalled = slower waver, blocked = low dissonant pulse.
 * Caps voices, sanitizes freqs, pauses on document.hidden, respects reduced-motion
 * (no new voices; existing fade out). Mute remembered in localStorage.
 */
import type { Health } from "./types.ts";

export const SOUND_STORAGE_KEY = "dash3d-sound-muted";
export const MAX_VOICES = 8;
export const MASTER_GAIN = 0.045; // quiet default when unmuted

export type HealthToneKind = "healthy" | "stalled" | "blocked" | "idle";

export type SoundVoiceSpec = {
  id: string;
  health: HealthToneKind;
  /** Optional pan -1..1 for spatial hint */
  pan?: number;
};

type VoiceHandle = {
  id: string;
  osc: OscillatorNode[];
  gain: GainNode;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  pan?: StereoPannerNode;
};

export type HealthSoundHandle = {
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly reducedMotion: boolean;
  /** Call from a click/pointer handler once. Idempotent. */
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  /** Sync voices to current bot health snapshot (max MAX_VOICES). */
  sync: (voices: readonly SoundVoiceSpec[]) => void;
  /** Suspend when tab hidden; resume when visible (if unlocked + unmuted). */
  setHidden: (hidden: boolean) => void;
  dispose: () => void;
};

export type HealthSoundOpts = {
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Inject AudioContext for tests. */
  contextFactory?: () => AudioContext;
  /** Initial muted (default: read storage, else true). */
  muted?: boolean;
  reducedMotion?: boolean;
  now?: () => number;
};

const FREQ: Record<HealthToneKind, number[]> = {
  healthy: [196], // soft G3 hum
  stalled: [146.8], // slower D3
  blocked: [98, 103.5], // low dissonant fifth-ish cluster
  idle: [],
};

function clampPan(p: number | undefined): number {
  if (!Number.isFinite(p)) return 0;
  return Math.max(-1, Math.min(1, p as number));
}

function normalizeHealth(h: string | null | undefined): HealthToneKind {
  if (h === "healthy" || h === "stalled" || h === "blocked" || h === "idle") return h;
  return "idle";
}

export function readStoredMute(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  if (!storage) return true;
  try {
    const v = storage.getItem(SOUND_STORAGE_KEY);
    if (v == null) return true;
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function writeStoredMute(storage: Pick<Storage, "setItem"> | null | undefined, muted: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(SOUND_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore quota */
  }
}

/** Rank so blocked/stalled get voice slots before healthy under the cap. */
export function prioritizeVoices(voices: readonly SoundVoiceSpec[], max = MAX_VOICES): SoundVoiceSpec[] {
  const rank: Record<HealthToneKind, number> = { blocked: 3, stalled: 2, healthy: 1, idle: 0 };
  const cleaned = voices
    .filter((v) => v && typeof v.id === "string" && v.id.length > 0)
    .map((v) => ({ id: v.id, health: normalizeHealth(v.health), pan: clampPan(v.pan) }))
    .filter((v) => FREQ[v.health].length > 0);
  cleaned.sort((a, b) => rank[b.health] - rank[a.health] || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const out: SoundVoiceSpec[] = [];
  for (const v of cleaned) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export function createHealthSound(opts: HealthSoundOpts = {}): HealthSoundHandle {
  const storage = opts.storage === undefined
    ? (typeof localStorage !== "undefined" ? localStorage : null)
    : opts.storage;
  let muted = opts.muted ?? readStoredMute(storage);
  let reducedMotion = Boolean(opts.reducedMotion);
  let unlocked = false;
  let disposed = false;
  let hidden = false;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  const voices = new Map<string, VoiceHandle>();
  let lastSpecs: SoundVoiceSpec[] = [];

  const ensureCtx = () => {
    if (ctx) return ctx;
    const factory = opts.contextFactory ?? (() => new AudioContext());
    ctx = factory();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    return ctx;
  };

  const setMaster = (target: number, t = 0.08) => {
    if (!ctx || !master) return;
    const g = master.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(Math.max(0, target), now + Math.max(0.02, t));
  };

  const stopVoice = (v: VoiceHandle, immediate = false) => {
    try {
      const now = ctx?.currentTime ?? 0;
      if (!immediate && ctx) {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0, now + 0.12);
        for (const o of v.osc) {
          try { o.stop(now + 0.14); } catch { /* already */ }
        }
        v.lfo?.stop(now + 0.14);
      } else {
        for (const o of v.osc) {
          try { o.stop(); } catch { /* */ }
        }
        try { v.lfo?.stop(); } catch { /* */ }
      }
    } catch {
      /* */
    }
    voices.delete(v.id);
  };

  const clearAll = (immediate = false) => {
    for (const v of [...voices.values()]) stopVoice(v, immediate);
  };

  const startVoice = (spec: SoundVoiceSpec) => {
    if (!ctx || !master || reducedMotion || muted || hidden) return;
    const freqs = FREQ[normalizeHealth(spec.health)];
    if (!freqs.length) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = clampPan(spec.pan);
    gain.connect(pan);
    pan.connect(master);
    const oscs: OscillatorNode[] = [];
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = spec.health === "blocked" ? "sawtooth" : "sine";
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      oscs.push(o);
    }
    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;
    if (spec.health === "stalled" || spec.health === "blocked") {
      lfo = ctx.createOscillator();
      lfoGain = ctx.createGain();
      lfo.frequency.value = spec.health === "stalled" ? 0.35 : 1.1;
      lfoGain.gain.value = spec.health === "stalled" ? 6 : 4;
      lfo.connect(lfoGain);
      for (const o of oscs) lfoGain.connect(o.frequency);
      lfo.start();
    }
    const now = ctx.currentTime;
    const level = spec.health === "blocked" ? 0.55 : spec.health === "stalled" ? 0.4 : 0.32;
    gain.gain.linearRampToValueAtTime(level / Math.max(1, freqs.length), now + 0.2);
    voices.set(spec.id, { id: spec.id, osc: oscs, gain, lfo, lfoGain, pan });
  };

  const applyMasterTarget = () => {
    if (!unlocked || muted || hidden || reducedMotion) setMaster(0, 0.05);
    else setMaster(MASTER_GAIN, 0.12);
  };

  const rebuild = (specs: readonly SoundVoiceSpec[]) => {
    lastSpecs = prioritizeVoices(specs);
    if (!unlocked || disposed) return;
    if (muted || hidden || reducedMotion) {
      clearAll();
      applyMasterTarget();
      return;
    }
    ensureCtx();
    const want = new Set(lastSpecs.map((s) => s.id));
    for (const [id, v] of [...voices]) {
      if (!want.has(id)) stopVoice(v);
    }
    for (const spec of lastSpecs) {
      const existing = voices.get(spec.id);
      if (existing) {
        // health change → restart
        const cur = normalizeHealth(spec.health);
        // simplest: if freq set length differs, restart
        if (existing.osc.length !== FREQ[cur].length) {
          stopVoice(existing, true);
          startVoice(spec);
        }
        continue;
      }
      startVoice(spec);
    }
    applyMasterTarget();
  };

  return {
    get unlocked() { return unlocked; },
    get muted() { return muted; },
    get reducedMotion() { return reducedMotion; },
    unlock() {
      if (disposed || unlocked) return;
      unlocked = true;
      const c = ensureCtx();
      void c.resume().catch(() => { /* autoplay policy */ });
      rebuild(lastSpecs);
    },
    setMuted(next) {
      if (disposed) return;
      muted = Boolean(next);
      writeStoredMute(storage, muted);
      rebuild(lastSpecs);
    },
    setReducedMotion(v) {
      if (disposed) return;
      reducedMotion = Boolean(v);
      rebuild(lastSpecs);
    },
    sync(next) {
      if (disposed) return;
      rebuild(next);
    },
    setHidden(h) {
      if (disposed) return;
      hidden = Boolean(h);
      if (hidden) {
        clearAll();
        if (ctx?.state === "running") void ctx.suspend().catch(() => {});
      } else if (unlocked && !muted) {
        void ctx?.resume().catch(() => {});
        rebuild(lastSpecs);
      }
      applyMasterTarget();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearAll(true);
      try { master?.disconnect(); } catch { /* */ }
      try { void ctx?.close(); } catch { /* */ }
      ctx = null;
      master = null;
      voices.clear();
    },
  };
}
