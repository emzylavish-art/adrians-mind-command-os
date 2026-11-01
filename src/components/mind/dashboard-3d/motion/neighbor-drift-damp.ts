/**
 * Multi-focus soft neighbor drift damp (Cosmos Motion Bot c18).
 *
 * When a star is focused, 1-hop constellation neighbors ease their orbit-drift
 * multiplier toward a soft floor (not fully pinned like the focus star) so the
 * local cluster settles for reading. Pure helpers — Dashboard Bot supplies the
 * adjacency list (edge endpoints / nhop depth-1). Reduced-motion → no extra damp
 * (neighbors stay at driftMul 1). Does not change star-batch / health-xfade /
 * focus-ring public APIs.
 */
import { clamp01, damp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";
import { isFocusedStar, type FocusEaseState } from "./focus-ease.ts";

/** Soft floor for neighbor drift (1 = full drift, 0 = pinned). */
export const NEIGHBOR_DRIFT_FLOOR = 0.35;
export const NEIGHBOR_DRIFT_LAMBDA = 7;

export type NeighborDriftDampOpts = {
  floor?: number;
  lambda?: number;
};

const EMPTY_NEIGHBOR_OPTS: NeighborDriftDampOpts = Object.freeze({});

/**
 * Build a Set of 1-hop neighbor ids from undirected edge endpoint pairs.
 * Skips self-loops / nulls. Allocates once when the graph changes — not per frame.
 */
export function collectOneHopNeighbors(
  edges: ReadonlyArray<readonly [string | null | undefined, string | null | undefined]>,
  focusId: string | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (typeof focusId !== "string" || focusId.length === 0) return out;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e) continue;
    const a = e[0];
    const b = e[1];
    if (typeof a !== "string" || a.length === 0) continue;
    if (typeof b !== "string" || b.length === 0) continue;
    if (a === b) continue;
    if (a === focusId) out.add(b);
    else if (b === focusId) out.add(a);
  }
  out.delete(focusId);
  return out;
}

/**
 * Target driftMul for a star given focus + neighbor set.
 * Focused star → 0 (handled by focus-ease); neighbor → floor; else → 1.
 */
export function neighborDriftTarget(
  starId: string | null | undefined,
  focusId: string | null | undefined,
  neighbors: ReadonlySet<string> | null | undefined,
  floor: number = NEIGHBOR_DRIFT_FLOOR,
): number {
  if (isFocusedStar(starId, focusId)) return 0;
  const f = clamp01(finiteOr(floor, NEIGHBOR_DRIFT_FLOOR));
  if (
    typeof starId === "string" &&
    starId.length > 0 &&
    neighbors &&
    neighbors.has(starId)
  ) {
    return f;
  }
  return 1;
}

/**
 * Ease one star's driftMul toward the neighbor/focus target.
 * Does not touch pulseMul (focus-ease owns that). Reduced-motion snaps to 1 for
 * neighbors (no extra damp) and leaves focus pinning to focus-ease.
 */
export function stepNeighborDriftDamp(
  state: FocusEaseState,
  starId: string | null | undefined,
  focusId: string | null | undefined,
  neighbors: ReadonlySet<string> | null | undefined,
  dt: number,
  reducedMotion: boolean,
  opts: NeighborDriftDampOpts = EMPTY_NEIGHBOR_OPTS,
): FocusEaseState {
  const o = opts ?? EMPTY_NEIGHBOR_OPTS;
  const floor = clamp01(finiteOr(o.floor ?? NEIGHBOR_DRIFT_FLOOR, NEIGHBOR_DRIFT_FLOOR));
  const lambda = finiteOr(o.lambda ?? NEIGHBOR_DRIFT_LAMBDA, NEIGHBOR_DRIFT_LAMBDA);
  const focused = isFocusedStar(starId, focusId);
  const isNeighbor =
    !focused &&
    typeof starId === "string" &&
    starId.length > 0 &&
    !!neighbors &&
    neighbors.has(starId);

  if (reducedMotion) {
    // Focus pinning stays with focus-ease; neighbors get no extra damp under RM.
    if (isNeighbor) state.driftMul = 1;
    return state;
  }

  if (focused) {
    // Let focus-ease drive driftMul → 0; do not fight it.
    return state;
  }

  const target = isNeighbor ? floor : 1;
  const d = sanitizeDt(dt);
  state.driftMul = damp(finiteOr(state.driftMul, 1), target, lambda, d);
  return state;
}

/**
 * Batch helper: after `stepFocusEase` (or star-batch), ease neighbor driftMuls.
 * `focusStates[i]` must align with `ids[i]`. Returns neighbors.size for debug.
 */
export function stepNeighborDriftDampBatch(
  ids: ReadonlyArray<string | null | undefined>,
  focusStates: FocusEaseState[],
  focusId: string | null | undefined,
  neighbors: ReadonlySet<string> | null | undefined,
  dt: number,
  reducedMotion: boolean,
  count?: number,
  opts: NeighborDriftDampOpts = EMPTY_NEIGHBOR_OPTS,
): number {
  const nWant = count == null ? ids.length : finiteOr(count, ids.length);
  const n = Math.max(0, Math.min(Math.floor(nWant), ids.length, focusStates.length));
  let touched = 0;
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    const st = focusStates[i];
    if (st == null) continue;
    const before = st.driftMul;
    stepNeighborDriftDamp(st, id, focusId, neighbors, dt, reducedMotion, opts);
    if (st.driftMul !== before) touched++;
  }
  return touched;
}
