/**
 * Pan / remount pose-hold helpers (Cosmos Motion Bot c9).
 *
 * Complements Dashboard queue #25 (last-frame WebGL freeze): when UniverseScene
 * remounts, local motion state (focus ease, character loco, breadcrumb, node open,
 * scene transition) would otherwise reset to defaults and snap. Capture → restore
 * keeps in-flight poses continuous across remount. Does not touch MotionClock
 * (shared clock already survives; never call hardReset on remount).
 *
 * Pure, allocation-light: capture writes into caller-owned hold objects.
 */
import { clamp01 } from "./ease.ts";
import { finiteOr } from "./sanitize.ts";
import type { FocusEaseState } from "./focus-ease.ts";
import type { CharacterMotionState } from "./character-motion.ts";
import type { BreadcrumbEaseState } from "./breadcrumb-ease.ts";
import type { NodeOpenState } from "./transition-ease.ts";
import type { SceneTransitionState } from "./transition-ease.ts";
import { normalizeSceneId } from "./transition-ease.ts";

export const POSE_HOLD_VERSION = 1 as const;

export type FocusPoseHold = { pulseMul: number; driftMul: number };
export type CharacterPoseHold = { loco: number; lookYaw: number };
export type BreadcrumbPoseHold = {
  amount: number;
  target: number;
  focusId: string | null;
};
export type NodeOpenPoseHold = { amount: number; target: number };
export type SceneTransitionPoseHold = {
  progress: number;
  target: number;
  fromId: string | null;
  toId: string | null;
};

export function createFocusPoseHold(): FocusPoseHold {
  return { pulseMul: 1, driftMul: 1 };
}
export function createCharacterPoseHold(): CharacterPoseHold {
  return { loco: 0, lookYaw: 0 };
}
export function createBreadcrumbPoseHold(): BreadcrumbPoseHold {
  return { amount: 0, target: 0, focusId: null };
}
export function createNodeOpenPoseHold(): NodeOpenPoseHold {
  return { amount: 0, target: 0 };
}
export function createSceneTransitionPoseHold(): SceneTransitionPoseHold {
  return { progress: 0, target: 0, fromId: null, toId: null };
}

export function captureFocusPose(out: FocusPoseHold, state: FocusEaseState): FocusPoseHold {
  out.pulseMul = finiteOr(state.pulseMul, 1);
  out.driftMul = clamp01(finiteOr(state.driftMul, 1));
  return out;
}
export function restoreFocusPose(state: FocusEaseState, hold: Readonly<FocusPoseHold>): void {
  state.pulseMul = finiteOr(hold.pulseMul, 1);
  state.driftMul = clamp01(finiteOr(hold.driftMul, 1));
}

export function captureCharacterPose(out: CharacterPoseHold, state: CharacterMotionState): CharacterPoseHold {
  out.loco = clamp01(finiteOr(state.loco, 0));
  out.lookYaw = finiteOr(state.lookYaw, 0);
  return out;
}
export function restoreCharacterPose(state: CharacterMotionState, hold: Readonly<CharacterPoseHold>): void {
  state.loco = clamp01(finiteOr(hold.loco, 0));
  state.lookYaw = finiteOr(hold.lookYaw, 0);
}

export function captureBreadcrumbPose(out: BreadcrumbPoseHold, state: BreadcrumbEaseState): BreadcrumbPoseHold {
  out.amount = clamp01(finiteOr(state.amount, 0));
  out.target = finiteOr(state.target, 0) >= 0.5 ? 1 : 0;
  out.focusId = typeof state.focusId === "string" && state.focusId.length > 0 ? state.focusId : null;
  return out;
}
export function restoreBreadcrumbPose(state: BreadcrumbEaseState, hold: Readonly<BreadcrumbPoseHold>): void {
  state.amount = clamp01(finiteOr(hold.amount, 0));
  state.target = finiteOr(hold.target, 0) >= 0.5 ? 1 : 0;
  state.focusId = typeof hold.focusId === "string" && hold.focusId.length > 0 ? hold.focusId : null;
}

export function captureNodeOpenPose(out: NodeOpenPoseHold, state: NodeOpenState): NodeOpenPoseHold {
  out.amount = clamp01(finiteOr(state.amount, 0));
  out.target = finiteOr(state.target, 0) >= 0.5 ? 1 : 0;
  return out;
}
export function restoreNodeOpenPose(state: NodeOpenState, hold: Readonly<NodeOpenPoseHold>): void {
  state.amount = clamp01(finiteOr(hold.amount, 0));
  state.target = finiteOr(hold.target, 0) >= 0.5 ? 1 : 0;
}

export function captureSceneTransitionPose(
  out: SceneTransitionPoseHold,
  state: SceneTransitionState,
): SceneTransitionPoseHold {
  out.progress = clamp01(finiteOr(state.progress, 0));
  out.target = finiteOr(state.target, 0) >= 0.5 ? 1 : 0;
  out.fromId = normalizeSceneId(state.fromId);
  out.toId = normalizeSceneId(state.toId);
  return out;
}
export function restoreSceneTransitionPose(
  state: SceneTransitionState,
  hold: Readonly<SceneTransitionPoseHold>,
): void {
  state.progress = clamp01(finiteOr(hold.progress, 0));
  state.target = finiteOr(hold.target, 0) >= 0.5 ? 1 : 0;
  state.fromId = normalizeSceneId(hold.fromId);
  state.toId = normalizeSceneId(hold.toId);
}

/**
 * Bag for a full scene remount. Caller owns the object and nested holds
 * (preallocate arrays/maps outside the rAF hot path).
 */
export type MotionPoseBag = {
  version: typeof POSE_HOLD_VERSION;
  focusById: Record<string, FocusPoseHold>;
  characterById: Record<string, CharacterPoseHold>;
  breadcrumb: BreadcrumbPoseHold;
  nodeOpen: NodeOpenPoseHold;
  sceneTx: SceneTransitionPoseHold;
};

export function createMotionPoseBag(): MotionPoseBag {
  return {
    version: POSE_HOLD_VERSION,
    focusById: Object.create(null) as Record<string, FocusPoseHold>,
    characterById: Object.create(null) as Record<string, CharacterPoseHold>,
    breadcrumb: createBreadcrumbPoseHold(),
    nodeOpen: createNodeOpenPoseHold(),
    sceneTx: createSceneTransitionPoseHold(),
  };
}

/** Sanitize a hold in place (NaN/overflow) — safe after JSON round-trip from session. */
export function sanitizeMotionPoseBag(bag: MotionPoseBag): MotionPoseBag {
  if (!bag || typeof bag !== "object") return createMotionPoseBag();
  bag.version = POSE_HOLD_VERSION;
  if (!bag.focusById || typeof bag.focusById !== "object") {
    bag.focusById = Object.create(null) as Record<string, FocusPoseHold>;
  }
  if (!bag.characterById || typeof bag.characterById !== "object") {
    bag.characterById = Object.create(null) as Record<string, CharacterPoseHold>;
  }
  for (const id of Object.keys(bag.focusById)) {
    const h = bag.focusById[id]!;
    h.pulseMul = finiteOr(h.pulseMul, 1);
    h.driftMul = clamp01(finiteOr(h.driftMul, 1));
  }
  for (const id of Object.keys(bag.characterById)) {
    const h = bag.characterById[id]!;
    h.loco = clamp01(finiteOr(h.loco, 0));
    h.lookYaw = finiteOr(h.lookYaw, 0);
  }
  if (!bag.breadcrumb) bag.breadcrumb = createBreadcrumbPoseHold();
  bag.breadcrumb.amount = clamp01(finiteOr(bag.breadcrumb.amount, 0));
  bag.breadcrumb.target = finiteOr(bag.breadcrumb.target, 0) >= 0.5 ? 1 : 0;
  bag.breadcrumb.focusId =
    typeof bag.breadcrumb.focusId === "string" && bag.breadcrumb.focusId.length > 0
      ? bag.breadcrumb.focusId
      : null;
  if (!bag.nodeOpen) bag.nodeOpen = createNodeOpenPoseHold();
  bag.nodeOpen.amount = clamp01(finiteOr(bag.nodeOpen.amount, 0));
  bag.nodeOpen.target = finiteOr(bag.nodeOpen.target, 0) >= 0.5 ? 1 : 0;
  if (!bag.sceneTx) bag.sceneTx = createSceneTransitionPoseHold();
  bag.sceneTx.progress = clamp01(finiteOr(bag.sceneTx.progress, 0));
  bag.sceneTx.target = finiteOr(bag.sceneTx.target, 0) >= 0.5 ? 1 : 0;
  bag.sceneTx.fromId = normalizeSceneId(bag.sceneTx.fromId);
  bag.sceneTx.toId = normalizeSceneId(bag.sceneTx.toId);
  return bag;
}
