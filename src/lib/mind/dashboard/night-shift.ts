/**
 * Queue #18 — City night-shift windows (pure).
 * Glow floors only when a building's real last activity (lock claim/release/heartbeat)
 * falls within the last 30 minutes. Reduced-motion → steady (no flicker flag).
 */
import { parseTimeMs } from "./health.ts";

export const NIGHT_SHIFT_MS = 30 * 60 * 1000;

export function isNightShiftActive(
  lastActivityAt: string | null | undefined,
  nowMs: number,
  windowMs = NIGHT_SHIFT_MS,
): boolean {
  const t = parseTimeMs(lastActivityAt ?? null, nowMs);
  if (t == null) return false;
  const age = nowMs - t;
  if (!Number.isFinite(age) || age < 0) return false;
  const win = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : NIGHT_SHIFT_MS;
  return age <= win;
}

/**
 * Which floor indices (1..floors-1, matching city-layer window loop) should get
 * night-shift glow. Uses real activity only — never invents work.
 */
export function nightShiftFloors(input: {
  floors: number;
  lastActivityAt: string | null | undefined;
  nowMs: number;
  reducedMotion?: boolean;
}): { active: boolean; floors: number[]; steady: boolean } {
  const floors = Number.isFinite(input.floors) ? Math.max(0, Math.min(48, Math.floor(input.floors))) : 0;
  const active = isNightShiftActive(input.lastActivityAt, input.nowMs);
  const steady = Boolean(input.reducedMotion) || !active;
  if (!active || floors < 2) return { active, floors: [], steady };
  // Light the upper third of floors as "work happening now" (deterministic from floor count).
  const start = Math.max(1, Math.floor(floors * (2 / 3)));
  const out: number[] = [];
  for (let f = start; f < floors; f++) out.push(f);
  return { active, floors: out, steady };
}
