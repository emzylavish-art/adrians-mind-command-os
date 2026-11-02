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
import {
  TRAVELER_POINT_BUDGET_TOTAL,
  allocateTravelerPointBudgets,
  resampleTravelerPolyline,
} from "./traveler-point-budget.ts";

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
  /** c33: focused traveler keeps full polyline under point budget. */
  focused?: boolean;
  /** c33: relative speed for budget weighting. */
  speed?: number;
  /** c33: last applied budget (debug / tests). */
  pointsBudget?: number;
  /** c33: scratch resampled points (owned by the trail; grown as needed). */
  activePoints?: TravelerXyz[];
};

export type TravelerTrailsOpts = {
  clock?: MotionClock;
  duration?: number;
  opacity?: number;
  /** Scene-wide hold (e.g. detail panel open, camera flying). Default false. */
  hold?: boolean;
  /** Max trails stepped per call. Default TRAVELER_TRAILS_MAX. */
  maxTrails?: number;
  /** c33: enable cam-distance / speed point budget. Default false (bit-identical). */
  enablePointBudget?: boolean;
  /** c33: camera distance for point LOD (world units). */
  camDistance?: number;
  /** c33: override global point ceiling. */
  pointBudgetTotal?: number;
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
  const useBudget = o.enablePointBudget === true;
  let budgets: number[] | null = null;
  if (useBudget) {
    const inputs = [];
    for (let i = 0; i < n; i++) {
      const tr = trails[i];
      if (!tr) {
        inputs.push(null);
        continue;
      }
      inputs.push({
        pointCount: Array.isArray(tr.points) ? tr.points.length : 0,
        focused: tr.focused === true,
        speed: tr.speed,
      });
    }
    budgets = allocateTravelerPointBudgets(
      inputs,
      o.camDistance ?? 0,
      o.pointBudgetTotal ?? TRAVELER_POINT_BUDGET_TOTAL,
    );
  }
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
    let pts: ReadonlyArray<Readonly<TravelerXyz>> = tr.points ?? [];
    if (budgets) {
      const full = Array.isArray(tr.points) ? tr.points.length : 0;
      let budget = budgets[i] ?? full;
      if (!Number.isFinite(budget) || budget < 0) budget = full;
      tr.pointsBudget = budget;
      if (budget > 0 && budget < full && Array.isArray(tr.points)) {
        if (!tr.activePoints || tr.activePoints.length < budget) {
          const fresh: TravelerXyz[] = [];
          for (let k = 0; k < Math.max(budget, tr.activePoints?.length ?? 0); k++) {
            fresh.push(tr.activePoints?.[k] ?? { x: 0, y: 0, z: 0 });
          }
          while (fresh.length < budget) fresh.push({ x: 0, y: 0, z: 0 });
          tr.activePoints = fresh;
        }
        const used = resampleTravelerPolyline(tr.activePoints, tr.points, budget);
        pts = tr.activePoints.slice(0, used);
      }
    }
    stepTravelerEase(tr.ease, tr.sample, pts, tSeconds, dt, reducedMotion, stepOpts as TravelerEaseOpts);
    const cur = tr.sample.progress;
    if (!reducedMotion && !wasPaused && isTravelerWrap(tr.lastProgress, cur)) wraps++;
    tr.lastProgress = cur;
  }
  return wraps;
}
