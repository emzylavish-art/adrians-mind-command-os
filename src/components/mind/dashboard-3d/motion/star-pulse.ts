/** Health-aware star pulse math — no allocations in the hot path. */
import { finiteOr } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";

export type PulseHealth = "healthy" | "stalled" | "blocked" | "idle";

export type PulseSample = {
  scale: number;
  glow: number;
  emissive: number;
};

const SPEED: Record<PulseHealth, number> = {
  healthy: 2.2,
  stalled: 1.1,
  blocked: 3.2,
  idle: 0,
};

const AMP: Record<PulseHealth, number> = {
  healthy: 0.1,
  stalled: 0.05,
  blocked: 0.14,
  idle: 0,
};

const GLOW_BASE = 2.0;
const GLOW_AMP: Record<PulseHealth, number> = {
  healthy: 0.3,
  stalled: 0.12,
  blocked: 0.4,
  idle: 0,
};

const EMISSIVE_BASE: Record<PulseHealth, number> = {
  healthy: 0.7,
  stalled: 0.55,
  blocked: 0.95,
  idle: 0.25,
};

const EMISSIVE_AMP: Record<PulseHealth, number> = {
  healthy: 0.2,
  stalled: 0.08,
  blocked: 0.25,
  idle: 0,
};

const HEALTHS: ReadonlySet<string> = new Set(["healthy", "stalled", "blocked", "idle"]);

export function normalizePulseHealth(health: string | null | undefined): PulseHealth {
  if (health && HEALTHS.has(health)) return health as PulseHealth;
  return "idle";
}

/** Sample pulse into a reusable out object (callers keep one PulseSample). */
export function sampleStarPulse(
  out: PulseSample,
  tSeconds: number,
  phase: number,
  health: PulseHealth | string,
  reducedMotion: boolean,
  /** Continuous clock (default shared). Pass a private clock in tests. */
  clock: MotionClock = sharedMotionClock,
): PulseSample {
  const h = normalizePulseHealth(health);
  if (reducedMotion || h === "idle") {
    out.scale = 1;
    out.glow = h === "idle" ? 1.6 : GLOW_BASE;
    out.emissive = EMISSIVE_BASE[h];
    return out;
  }
  const t = clock.map(tSeconds);
  const ph = finiteOr(phase, 0);
  const speed = SPEED[h];
  const wave = Math.sin(t * speed + ph);
  out.scale = 1 + wave * AMP[h];
  out.glow = GLOW_BASE + wave * GLOW_AMP[h];
  out.emissive = EMISSIVE_BASE[h] + Math.sin(t * (speed + 0.8) + ph) * EMISSIVE_AMP[h];
  return out;
}

export function pulsePhaseFromId(id: string | null | undefined): number {
  const s = id ?? "";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 4294967296;
  return u * Math.PI * 2;
}
