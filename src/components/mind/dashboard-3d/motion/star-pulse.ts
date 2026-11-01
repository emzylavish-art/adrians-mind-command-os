/** Health-aware star pulse math — no allocations in the hot path. */

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

/** Sample pulse into a reusable out object (callers keep one PulseSample). */
export function sampleStarPulse(
  out: PulseSample,
  tSeconds: number,
  phase: number,
  health: PulseHealth,
  reducedMotion: boolean,
): PulseSample {
  if (reducedMotion || health === "idle") {
    out.scale = 1;
    out.glow = health === "idle" ? 1.6 : GLOW_BASE;
    out.emissive = EMISSIVE_BASE[health];
    return out;
  }
  const speed = SPEED[health];
  const wave = Math.sin(tSeconds * speed + phase);
  out.scale = 1 + wave * AMP[health];
  out.glow = GLOW_BASE + wave * GLOW_AMP[health];
  out.emissive = EMISSIVE_BASE[health] + Math.sin(tSeconds * (speed + 0.8) + phase) * EMISSIVE_AMP[health];
  return out;
}

export function pulsePhaseFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 4294967296;
  return u * Math.PI * 2;
}
