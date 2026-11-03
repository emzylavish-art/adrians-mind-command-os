/**
 * Landing-trail batch step (Cosmos Motion Bot c21).
 *
 * One call per frame for all landing travelers: applies an optional scene-wide hold
 * (panel open / flyover / focus) through the c21 churn-safe pause/resume, steps each
 * traveler, and counts genuine forward loop wraps (for the c13 dust gust) without
 * false positives from holds, reduced-motion or garbage progress. No per-frame alloc.
 * Dashboard Bot keeps mesh/material ownership and writes positions from `trail.sample`.
 */
import {
  pauseTraveler,
  resumeTraveler,
  stepTravelerEase,
  type TravelerEaseOpts,
  type TravelerEaseSample,
  type TravelerEaseState,
  type TravelerXyz,
} from "./traveler-ease.ts";
import type { MotionClock } from "./motion-clock.ts";

export const TRAVELER_TRAILS_MAX = 256;
/** A wrap only counts if the forward step across 1→0 is at most this fraction of a lap. */
export const TRAVELER_WRAP_MAX_STEP = 0.25;

export type TravelerTrail = {
  ease: TravelerEaseState;
  sample: TravelerEaseSample;
  points: ReadonlyArray<Readonly<TravelerXyz>>;
  /** Progress from the previous frame (written by stepTravelerTrails). */
  lastProgress: number;
  /** Set while the batch hold owns the pause, so it never resumes a caller's own pause. */
  holdOwned?: boolean;
};

export type TravelerTrailsOpts = {
  clock?: MotionClock;
  duration?: number;
  opacity?: number;
  /** Scene-wide hold (e.g. detail panel open, camera flying). Default false. */
  hold?: boolean;
  /** Max trails stepped per call. Default TRAVELER_TRAILS_MAX. */
  maxTrails?: number;
};

const EMPTY: TravelerTrailsOpts = Object.freeze({});
// Reused per call; fields overwritten every step (no per-frame alloc).
const stepOpts: { clock?: MotionClock; duration?: number; opacity?: number } = {};

/** True when prev→cur is a small forward step that crossed the loop seam. */
export function isTravelerWrap(prev: number, cur: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return false;
  if (!(prev >= 0 && prev < 1 && cur >= 0 && cur < 1)) return false;
  if (cur >= prev) return false;
  return 1 - prev + cur <= TRAVELER_WRAP_MAX_STEP;
}

/**
 * Step every trail. Returns the number of genuine wraps this frame (0 under
 * reduced-motion or hold). Null / malformed entries are skipped.
 */
export function stepTravelerTrails(
  trails: ReadonlyArray<TravelerTrail | null | undefined>,
  tSeconds: number,
  dt: number,
  reducedMotion: boolean,
  opts: TravelerTrailsOpts = EMPTY,
): number {
  if (!trails || typeof trails.length !== "number") return 0;
  const o = opts ?? EMPTY;
  const hold = o.hold === true;
  let max = o.maxTrails ?? TRAVELER_TRAILS_MAX;
  if (!Number.isFinite(max) || max < 0) max = TRAVELER_TRAILS_MAX;
  const n = Math.min(trails.length, Math.floor(max));
  stepOpts.clock = o.clock;
  stepOpts.duration = o.duration;
  stepOpts.opacity = o.opacity;
  let wraps = 0;
  for (let i = 0; i < n; i++) {
    const tr = trails[i];
    if (!tr || !tr.ease || !tr.sample) continue;
    if (hold) {
      if (!tr.ease.paused) {
        pauseTraveler(tr.ease);
        tr.holdOwned = true;
      }
    } else if (tr.holdOwned) {
      resumeTraveler(tr.ease);
      tr.holdOwned = false;
    }
    const wasPaused = tr.ease.paused;
    stepTravelerEase(tr.ease, tr.sample, tr.points ?? [], tSeconds, dt, reducedMotion, stepOpts as TravelerEaseOpts);
    const cur = tr.sample.progress;
    if (!reducedMotion && !wasPaused && isTravelerWrap(tr.lastProgress, cur)) wraps++;
    tr.lastProgress = cur;
  }
  return wraps;
}
