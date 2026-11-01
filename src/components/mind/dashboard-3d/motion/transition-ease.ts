/**
 * Node open/close + scene transition easing (Cosmos Motion Bot c6).
 *
 * Interruptible: reversing mid-animation (close while opening, or cancel a scene
 * crossfade) continues from the current amount — never restarts from 0/1.
 * Pure helpers, reusable out samples, zero hot-path allocation.
 * Reduced-motion snaps instantly to the target.
 */
import { clamp01, easeInOutCubic, easeOutQuint, lerp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";

export const NODE_OPEN_DURATION = 0.35;
export const NODE_OPEN_OFFSET_Y = 0.35;
export const NODE_OPEN_SCALE_FROM = 0.86;
export const SCENE_TRANSITION_DURATION = 0.55;

/** Linear open amount 0..1 + desired target (0 closed / 1 open). */
export type NodeOpenState = {
  amount: number;
  target: number;
};

export type NodeOpenSample = {
  /** Mesh scale: NODE_OPEN_SCALE_FROM → 1. */
  scale: number;
  /** Opacity 0 → 1. */
  opacity: number;
  /** Vertical lift 0 → openOffsetY. */
  offsetY: number;
  /** Linear amount 0..1. */
  amount: number;
  done: boolean;
};

export type NodeOpenOpts = {
  duration?: number;
  openOffsetY?: number;
  scaleFrom?: number;
};

export function createNodeOpenState(open = false): NodeOpenState {
  const v = open ? 1 : 0;
  return { amount: v, target: v };
}

export function setNodeOpen(state: NodeOpenState, open: boolean): void {
  state.target = open ? 1 : 0;
}

export function createNodeOpenSample(): NodeOpenSample {
  return { scale: NODE_OPEN_SCALE_FROM, opacity: 0, offsetY: 0, amount: 0, done: true };
}

/**
 * Advance node open/close. Closing halfway through opening resumes from current amount.
 * Writes into `out` (caller reuses one sample). Unknown: pass any state; ids are scene-side.
 */
export function stepNodeOpen(
  state: NodeOpenState,
  out: NodeOpenSample,
  dt: number,
  reducedMotion: boolean,
  opts: NodeOpenOpts = {},
): NodeOpenSample {
  const duration = Math.max(1e-4, finiteOr(opts.duration ?? NODE_OPEN_DURATION, NODE_OPEN_DURATION));
  const offsetY = finiteOr(opts.openOffsetY ?? NODE_OPEN_OFFSET_Y, NODE_OPEN_OFFSET_Y);
  const scaleFrom = finiteOr(opts.scaleFrom ?? NODE_OPEN_SCALE_FROM, NODE_OPEN_SCALE_FROM);
  let target = finiteOr(state.target, 0);
  target = target >= 0.5 ? 1 : 0;
  state.target = target;
  let amount = clamp01(finiteOr(state.amount, 0));

  if (reducedMotion) {
    amount = target;
  } else if (amount !== target) {
    const step = sanitizeDt(dt) / duration;
    if (amount < target) amount = Math.min(target, amount + step);
    else amount = Math.max(target, amount - step);
  }
  state.amount = amount;

  const e = easeInOutCubic(amount);
  out.scale = lerp(scaleFrom, 1, e);
  out.opacity = e;
  out.offsetY = e * offsetY;
  out.amount = amount;
  out.done = amount === target;
  return out;
}

/** Scene crossfade / dolly progress (universe↔city↔interior etc.). */
export type SceneTransitionState = {
  progress: number;
  target: number;
  fromId: string | null;
  toId: string | null;
};

export type SceneTransitionSample = {
  /** Linear 0..1. */
  linear: number;
  /** Eased (easeInOutCubic) — general progress. */
  eased: number;
  /** Outgoing scene opacity 1 → 0. */
  fadeOut: number;
  /** Incoming scene opacity 0 → 1. */
  fadeIn: number;
  /** Dolly factor (easeOutQuint) 0 → 1. */
  dolly: number;
  done: boolean;
  fromId: string | null;
  toId: string | null;
};

export type SceneTransitionOpts = {
  duration?: number;
};

export function createSceneTransitionState(
  fromId: string | null = null,
  toId: string | null = null,
): SceneTransitionState {
  return { progress: 0, target: 0, fromId: normalizeId(fromId), toId: normalizeId(toId) };
}

export function createSceneTransitionSample(): SceneTransitionSample {
  return {
    linear: 0,
    eased: 0,
    fadeOut: 1,
    fadeIn: 0,
    dolly: 0,
    done: true,
    fromId: null,
    toId: null,
  };
}

/** Empty / non-string ids collapse to null (unknown). */
export function normalizeSceneId(id: string | null | undefined): string | null {
  return normalizeId(id);
}

function normalizeId(id: string | null | undefined): string | null {
  if (typeof id !== "string") return null;
  const s = id.trim();
  return s.length === 0 ? null : s;
}

/**
 * Start or retarget a transition. Interruptible: if already mid-way toward `toId`,
 * progress is kept; swapping direction sets target 0 or 1 without snapping.
 */
export function beginSceneTransition(
  state: SceneTransitionState,
  fromId: string | null | undefined,
  toId: string | null | undefined,
): void {
  const from = normalizeId(fromId);
  const to = normalizeId(toId);
  // Same corridor (from→to already active): keep progress, ensure target=1.
  if (state.fromId === from && state.toId === to && to != null) {
    state.target = 1;
    return;
  }
  // Reverse of active pair (to→from): reverse target, keep progress (complement).
  if (state.fromId === to && state.toId === from && state.fromId != null) {
    state.progress = clamp01(1 - state.progress);
    state.fromId = from;
    state.toId = to;
    state.target = 1;
    return;
  }
  state.fromId = from;
  state.toId = to;
  state.progress = 0;
  state.target = to == null && from == null ? 0 : 1;
}

/** Cancel toward the start of the current corridor (interruptible close). */
export function cancelSceneTransition(state: SceneTransitionState): void {
  state.target = 0;
}

export function stepSceneTransition(
  state: SceneTransitionState,
  out: SceneTransitionSample,
  dt: number,
  reducedMotion: boolean,
  opts: SceneTransitionOpts = {},
): SceneTransitionSample {
  const duration = Math.max(1e-4, finiteOr(opts.duration ?? SCENE_TRANSITION_DURATION, SCENE_TRANSITION_DURATION));
  let target = finiteOr(state.target, 0);
  target = target >= 0.5 ? 1 : 0;
  state.target = target;
  let progress = clamp01(finiteOr(state.progress, 0));

  if (reducedMotion) {
    progress = target;
  } else if (progress !== target) {
    const step = sanitizeDt(dt) / duration;
    if (progress < target) progress = Math.min(target, progress + step);
    else progress = Math.max(target, progress - step);
  }
  state.progress = progress;

  const eased = easeInOutCubic(progress);
  const dolly = easeOutQuint(progress);
  out.linear = progress;
  out.eased = eased;
  out.fadeOut = 1 - eased;
  out.fadeIn = eased;
  out.dolly = dolly;
  out.done = progress === target;
  out.fromId = state.fromId;
  out.toId = state.toId;
  return out;
}
