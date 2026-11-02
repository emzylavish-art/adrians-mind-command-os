/**
 * Landing-trail batch step (Cosmos Motion Bot c21; c33–c36 point budget / throttle / focus-flip / hold×focus).
 *
 * One call per frame for all landing travelers: applies an optional scene-wide hold
 * (panel open / flyover / focus) through the c21 churn-safe pause/resume, steps each
 * traveler, and counts genuine forward loop wraps (for the c13 dust gust) without
 * false positives from holds, reduced-motion or garbage progress. No per-frame alloc
 * on the hot path when the point-budget band is unchanged (c34).
 * Dashboard Bot keeps mesh/material ownership and writes positions from `trail.sample`;
 * use `consumeTravelerPointsDirty` to gate BufferAttribute uploads.
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

const EMPTY_PTS: ReadonlyArray<Readonly<TravelerXyz>> = Object.freeze([]);

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
  /** c33: last applied budget (debug / tests). Cleared when enablePointBudget is off. */
  pointsBudget?: number;
  /** c33: scratch resampled points (owned by the trail; grown as needed). */
  activePoints?: TravelerXyz[];
  /** c34: activePoints (or budget band) changed since last consumeTravelerPointsDirty. */
  pointsDirty?: boolean;
  /** c34: resample invocations (tests / meters). */
  resampleCount?: number;
  /** c34: last mapped clock time that drove a resample. */
  _lastMappedT?: number;
  /** c34: last applied budget signature (pointsBudget or -1 when off). */
  _lastBudgetSig?: number;
  /** c34: cached pts ref passed to ease (avoid slice alloc on skip). */
  _stepPtsRef?: ReadonlyArray<Readonly<TravelerXyz>>;
  /** c35: Dashboard marks true after mesh dispose — step skips safely. */
  disposed?: boolean;
  /** c35: previous focused latch for edge-forced dirty resample. */
  _wasFocused?: boolean;
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
 * c34: Dashboard calls after copying activePoints into a BufferAttribute.
 * Returns true once per dirty edge, then clears the flag.
 */
export function consumeTravelerPointsDirty(
  tr: TravelerTrail | null | undefined,
): boolean {
  if (!tr || tr.pointsDirty !== true) return false;
  tr.pointsDirty = false;
  return true;
}

function ensureActiveCapacity(tr: TravelerTrail, budget: number): TravelerXyz[] {
  if (!tr.activePoints || tr.activePoints.length < budget) {
    const fresh: TravelerXyz[] = [];
    const prev = tr.activePoints;
    const keep = prev?.length ?? 0;
    for (let k = 0; k < Math.max(budget, keep); k++) {
      fresh.push(prev?.[k] ?? { x: 0, y: 0, z: 0 });
    }
    while (fresh.length < budget) fresh.push({ x: 0, y: 0, z: 0 });
    tr.activePoints = fresh;
  }
  return tr.activePoints;
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

  // Mapped time for duplicate-tick skip (c34). clock.map is idempotent on same wall t.
  const mappedT = o.clock ? o.clock.map(tSeconds) : tSeconds;

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
    // Sanitize total: NaN→default; ≤0 → 0 (hard empty — never escape to full).
    let total = o.pointBudgetTotal;
    if (total === undefined || total === null) total = TRAVELER_POINT_BUDGET_TOTAL;
    else if (!Number.isFinite(total) || total < 0) total = 0;
    else total = Math.trunc(total);
    budgets = allocateTravelerPointBudgets(inputs, o.camDistance ?? 0, total);
  }

  for (let i = 0; i < n; i++) {
    const tr = trails[i];
    if (!tr || tr.disposed === true || !tr.ease || !tr.sample) continue;
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
    let pts: ReadonlyArray<Readonly<TravelerXyz>> = tr.points ?? EMPTY_PTS;

    if (!useBudget) {
      // c34 hacker: toggling OFF mid-flight must clear stale budget so readers
      // (and Dashboard uploads) do not keep a thin residual.
      if (tr.pointsBudget !== undefined || tr._lastBudgetSig !== undefined) {
        tr.pointsBudget = undefined;
        tr._lastBudgetSig = -1;
        tr._lastMappedT = undefined;
        tr._stepPtsRef = undefined;
        tr._wasFocused = undefined;
        tr.pointsDirty = true;
      }
      pts = tr.points ?? EMPTY_PTS;
    } else {
      const full = Array.isArray(tr.points) ? tr.points.length : 0;
      let budget = budgets ? (budgets[i] ?? 0) : 0;
      // c34 hacker: 0 / negative / NaN → empty park, NEVER fall through to full poly.
      if (!Number.isFinite(budget) || budget < 0) budget = 0;
      budget = Math.trunc(budget);
      if (budget > full) budget = full;
      tr.pointsBudget = budget;

      // c35: focus edge forces dirty full/thin snap (no one-frame stale cache).
      // c36: under hold (or holdOwned pause), do NOT resample — focus flips must not
      // teleport the frozen sample. Desired budget is recorded; geometry applies on resume.
      const focusNow = tr.focused === true;
      const frozenByHold = hold === true || tr.holdOwned === true;
      if (!frozenByHold && focusNow !== (tr._wasFocused === true)) {
        tr._lastMappedT = undefined;
        tr._lastBudgetSig = Number.NaN;
      }
      tr._wasFocused = focusNow;

      const sameT = tr._lastMappedT === mappedT;
      const sameBudget = tr._lastBudgetSig === budget;
      if (frozenByHold && tr._stepPtsRef) {
        pts = tr._stepPtsRef;
      } else if (sameT && sameBudget && tr._stepPtsRef) {
        pts = tr._stepPtsRef;
      } else {
        tr.resampleCount = (tr.resampleCount ?? 0) + 1;
        tr.pointsDirty = true;
        tr._lastMappedT = mappedT;
        tr._lastBudgetSig = budget;
        if (budget <= 0 || full === 0) {
          pts = EMPTY_PTS;
          tr._stepPtsRef = EMPTY_PTS;
        } else if (budget < full && Array.isArray(tr.points)) {
          const buf = ensureActiveCapacity(tr, budget);
          const used = resampleTravelerPolyline(buf, tr.points, budget);
          // Reuse a stable prefix array on the trail to avoid slice alloc next skip.
          if (!tr._stepPtsRef || tr._stepPtsRef === EMPTY_PTS || (tr._stepPtsRef as TravelerXyz[]).length !== used) {
            const view: TravelerXyz[] = [];
            for (let k = 0; k < used; k++) view.push(buf[k]!);
            tr._stepPtsRef = view;
          } else {
            const view = tr._stepPtsRef as TravelerXyz[];
            for (let k = 0; k < used; k++) {
              view[k]!.x = buf[k]!.x;
              view[k]!.y = buf[k]!.y;
              view[k]!.z = buf[k]!.z;
            }
          }
          pts = tr._stepPtsRef;
        } else {
          pts = tr.points ?? EMPTY_PTS;
          tr._stepPtsRef = pts;
        }
      }
    }

    stepTravelerEase(tr.ease, tr.sample, pts, tSeconds, dt, reducedMotion, stepOpts as TravelerEaseOpts);
    const cur = tr.sample.progress;
    if (!reducedMotion && !wasPaused && isTravelerWrap(tr.lastProgress, cur)) wraps++;
    tr.lastProgress = cur;
  }
  return wraps;
}
