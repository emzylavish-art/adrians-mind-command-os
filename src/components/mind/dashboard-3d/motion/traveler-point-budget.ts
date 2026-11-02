/**
 * Motion c33 — traveler polyline point budget.
 *
 * Cap/resample landing-trail vertices by camera distance (hysteretic LOD) and
 * traveler speed; focused travelers keep full resolution. A global total budget
 * prevents overflow when many long trails are live. Pure helpers — mesh ownership
 * stays with Dashboard Bot.
 */
import { finiteOr } from "./sanitize.ts";
import type { TravelerXyz } from "./traveler-ease.ts";

export const TRAVELER_POINT_NEAR = 22;
export const TRAVELER_POINT_FAR = 70;
export const TRAVELER_POINT_HYST = 12;
export const TRAVELER_POINT_MIN = 2;
/** Soft ceiling across all trails stepped in one frame. */
export const TRAVELER_POINT_BUDGET_TOTAL = 2048;

export type TravelerPointLodState = {
  active: number;
  band: 0 | 1;
  full: number;
};

export type TravelerPointLodOpts = {
  near?: number;
  far?: number;
  hyst?: number;
  farMin?: number;
};

export type TravelerBudgetInput = {
  pointCount: number;
  focused?: boolean;
  /** Relative speed ≥0; faster keeps more points. Default 1. */
  speed?: number;
};

export function createTravelerPointLodState(full: number): TravelerPointLodState {
  const n = Math.max(0, Math.trunc(finiteOr(full, 0)));
  return { active: n, band: 0, full: n };
}

/**
 * Hysteretic point count from camera distance (mirrors comet seg LOD).
 * NaN / ≤0 → near (full). +Infinity → far. Camera teleport into the hyst band
 * does not flicker once the far band is latched.
 */
export function stepTravelerPointLod(
  state: TravelerPointLodState | null | undefined,
  camDistance: number,
  full: number,
  opts?: TravelerPointLodOpts,
): number {
  const nFull = Math.max(0, Math.trunc(finiteOr(full, 0)));
  if (!state) return nFull;
  if (state.full !== nFull) {
    state.full = nFull;
    state.active = Math.min(Math.max(state.active, 0), nFull);
  }
  if (nFull === 0) {
    state.active = 0;
    state.band = 0;
    return 0;
  }
  const near = finiteOr(opts?.near ?? TRAVELER_POINT_NEAR, TRAVELER_POINT_NEAR);
  const far = Math.max(near + 1, finiteOr(opts?.far ?? TRAVELER_POINT_FAR, TRAVELER_POINT_FAR));
  const hyst = Math.max(0, finiteOr(opts?.hyst ?? TRAVELER_POINT_HYST, TRAVELER_POINT_HYST));
  const farMin = Math.min(
    nFull,
    Math.max(TRAVELER_POINT_MIN, Math.trunc(finiteOr(opts?.farMin ?? TRAVELER_POINT_MIN, TRAVELER_POINT_MIN))),
  );

  let d: number;
  if (!Number.isFinite(camDistance)) {
    d = camDistance === Number.POSITIVE_INFINITY ? far + 1 : 0;
  } else if (camDistance <= 0) {
    d = 0;
  } else {
    d = camDistance;
  }

  if (state.band === 0) {
    if (d >= far) state.band = 1;
  } else if (d <= far - hyst) {
    state.band = 0;
  }

  state.active = state.band === 0 ? nFull : farMin;
  return state.active;
}

/** Scale a base budget by speed (clamped); faster travelers keep more detail. */
export function travelerPointBudgetForSpeed(baseBudget: number, speed: number): number {
  const base = Math.max(0, Math.trunc(finiteOr(baseBudget, 0)));
  if (base === 0) return 0;
  const sp = Math.max(0, finiteOr(speed, 1));
  // speed 1 → 1×; speed 2 → ~1.35×; capped at 1.5×
  const mul = Math.min(1.5, 1 + Math.max(0, sp - 1) * 0.35);
  return Math.max(TRAVELER_POINT_MIN, Math.min(base, Math.round(base * mul)));
}

/**
 * Allocate per-trail point budgets under a global ceiling.
 * Focused trails take their full pointCount first; remainder is shared.
 */
export function allocateTravelerPointBudgets(
  trails: ReadonlyArray<TravelerBudgetInput | null | undefined>,
  camDistance: number,
  totalBudget: number = TRAVELER_POINT_BUDGET_TOTAL,
  lodState?: TravelerPointLodState,
): number[] {
  const out: number[] = [];
  if (!trails || typeof trails.length !== "number") return out;
  const cap = Math.max(0, Math.trunc(finiteOr(totalBudget, TRAVELER_POINT_BUDGET_TOTAL)));
  const lod = lodState ?? createTravelerPointLodState(1);

  let reserved = 0;
  const wants: number[] = [];
  for (let i = 0; i < trails.length; i++) {
    const tr = trails[i];
    if (!tr) {
      wants.push(0);
      continue;
    }
    const full = Math.max(0, Math.trunc(finiteOr(tr.pointCount, 0)));
    if (tr.focused) {
      wants.push(full);
      reserved += full;
      continue;
    }
    const distBudget = stepTravelerPointLod(lod, camDistance, full);
    // Reset lod.full per trail — each has its own full count; keep band from distance.
    lod.full = full;
    lod.active = lod.band === 0 ? full : Math.min(full, Math.max(TRAVELER_POINT_MIN, lod.active));
    const withSpeed = travelerPointBudgetForSpeed(distBudget, tr.speed ?? 1);
    wants.push(Math.min(full, withSpeed));
  }

  // If focused alone overflow, scale focused down proportionally (still ≥ MIN when full≥MIN).
  if (reserved > cap) {
    const scale = cap / reserved;
    for (let i = 0; i < wants.length; i++) {
      const tr = trails[i];
      if (tr?.focused) {
        const full = Math.max(0, Math.trunc(finiteOr(tr.pointCount, 0)));
        wants[i] = full === 0 ? 0 : Math.max(TRAVELER_POINT_MIN, Math.floor(full * scale));
      } else wants[i] = 0;
    }
    return wants;
  }

  let remain = cap - reserved;
  // First pass: give each non-focus its want if possible
  for (let i = 0; i < wants.length; i++) {
    const tr = trails[i];
    if (!tr || tr.focused) continue;
    const w = wants[i]!;
    if (w <= remain) {
      remain -= w;
    } else {
      wants[i] = remain >= TRAVELER_POINT_MIN ? remain : remain > 0 ? remain : 0;
      remain = 0;
    }
  }
  return wants;
}

/**
 * Resample `points` into `out[0..budget)` inclusive of endpoints.
 * Returns the number of points written. No alloc beyond caller-provided `out`.
 */
export function resampleTravelerPolyline(
  out: TravelerXyz[],
  points: ReadonlyArray<Readonly<TravelerXyz> | null | undefined>,
  budget: number,
): number {
  if (!Array.isArray(points) || points.length === 0 || !out || out.length === 0) return 0;
  const nFull = points.length;
  let n = Math.trunc(finiteOr(budget, 0));
  if (n <= 0) return 0;
  if (n > out.length) n = out.length;
  if (n >= nFull) {
    const m = Math.min(nFull, out.length);
    for (let i = 0; i < m; i++) {
      const p = points[i];
      const o = out[i]!;
      if (p && typeof p === "object") {
        o.x = finiteOr(p.x, o.x);
        o.y = finiteOr(p.y, o.y);
        o.z = finiteOr(p.z, o.z);
      }
    }
    return m;
  }
  if (n === 1) {
    const p = points[0];
    const o = out[0]!;
    if (p && typeof p === "object") {
      o.x = finiteOr(p.x, 0);
      o.y = finiteOr(p.y, 0);
      o.z = finiteOr(p.z, 0);
    }
    return 1;
  }
  const last = n - 1;
  for (let i = 0; i < n; i++) {
    const u = i / last;
    const srcF = u * (nFull - 1);
    const i0 = Math.floor(srcF);
    const i1 = Math.min(nFull - 1, i0 + 1);
    const t = srcF - i0;
    const a = points[i0];
    const b = points[i1];
    const o = out[i]!;
    const ax = a && typeof a === "object" ? finiteOr(a.x, 0) : 0;
    const ay = a && typeof a === "object" ? finiteOr(a.y, 0) : 0;
    const az = a && typeof a === "object" ? finiteOr(a.z, 0) : 0;
    const bx = b && typeof b === "object" ? finiteOr(b.x, ax) : ax;
    const by = b && typeof b === "object" ? finiteOr(b.y, ay) : ay;
    const bz = b && typeof b === "object" ? finiteOr(b.z, az) : az;
    o.x = ax + (bx - ax) * t;
    o.y = ay + (by - ay) * t;
    o.z = az + (bz - az) * t;
  }
  return n;
}
