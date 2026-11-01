/**
 * Pure health → atmosphere mappings for the light lane.
 * Complements painted-universe sky/nebula (owned by Dashboard / Painter bots).
 */
export type HealthTone = "healthy" | "stalled" | "blocked" | "idle";

export type Rgb = readonly [number, number, number];

/** Hex colors matching dashboard HEALTH_COLOR language. */
export const HEALTH_HEX: Record<HealthTone, number> = {
  healthy: 0x3dd68c,
  stalled: 0xfbbf24,
  blocked: 0xff6b8a,
  idle: 0x5b6b8c,
};

/** Soft ambient RGB (0–1) for hemisphere / ambient fill. */
export const AMBIENT_RGB: Record<HealthTone, Rgb> = {
  healthy: [0.42, 0.72, 0.58],
  stalled: [0.72, 0.58, 0.32],
  blocked: [0.72, 0.38, 0.48],
  idle: [0.42, 0.48, 0.62],
};

/** Key / sun light RGB. */
export const KEY_RGB: Record<HealthTone, Rgb> = {
  healthy: [1.0, 0.92, 0.72],
  stalled: [1.0, 0.82, 0.48],
  blocked: [1.0, 0.55, 0.58],
  idle: [0.85, 0.88, 1.0],
};

/** Rim / fill RGB (cool accent that shifts with tone). */
export const RIM_RGB: Record<HealthTone, Rgb> = {
  healthy: [0.35, 0.85, 0.72],
  stalled: [0.85, 0.55, 0.25],
  blocked: [0.95, 0.28, 0.42],
  idle: [0.48, 0.36, 0.95],
};

/** Fog clear color hex + density. */
export const FOG_PARAMS: Record<HealthTone, { color: number; density: number }> = {
  healthy: { color: 0x04140e, density: 0.016 },
  stalled: { color: 0x141004, density: 0.02 },
  blocked: { color: 0x14040a, density: 0.024 },
  idle: { color: 0x050814, density: 0.018 },
};

/** Derive fleet tone: blocked > stalled > healthy > idle. */
export function deriveFleetTone(healths: readonly HealthTone[]): HealthTone {
  // Runtime data can be missing/malformed; junk entries count as neutral idle.
  healths = Array.isArray(healths) ? healths.map(normalizeHealthTone) : [];
  if (healths.length === 0) return "idle";
  if (healths.some((h) => h === "blocked")) return "blocked";
  if (healths.some((h) => h === "stalled")) return "stalled";
  if (healths.some((h) => h === "healthy")) return "healthy";
  return "idle";
}

export function isHealthTone(value: unknown): value is HealthTone {
  return value === "healthy" || value === "stalled" || value === "blocked" || value === "idle";
}

/**
 * Missing / unknown health must read as neutral ("idle"), never green and
 * never a crash in the render loop (light hacker pass, cycle 2).
 */
export function normalizeHealthTone(value: unknown): HealthTone {
  return isHealthTone(value) ? value : "idle";
}
