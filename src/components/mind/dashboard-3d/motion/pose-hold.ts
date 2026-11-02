/**
 * Pan / remount pose-hold helpers (Cosmos Motion Bot c9 / hardened c10).
 *
 * Complements Dashboard queue #25 (last-frame WebGL freeze): when UniverseScene
 * remounts, local motion state (focus ease, character loco, breadcrumb, node open,
 * scene transition) would otherwise reset to defaults and snap. Capture → restore
 * keeps in-flight poses continuous across remount. Does not touch MotionClock
 * (shared clock already survives; never call hardReset on remount).
 *
 * Pure, allocation-light: capture writes into caller-owned hold objects.
 * c10: JSON parse / sanitize rejects foreign versions, wrong types, __proto__ keys,
 * and restore-*ForKnownIds skips stale ids removed from the live scene.
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

/** Max entries accepted from a sessionStorage bag (DoS / huge-array guard). */
export const POSE_HOLD_MAX_IDS = 512;

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

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function numField(v: unknown, fallback: number): number {
  return typeof v === "number" ? finiteOr(v, fallback) : fallback;
}

function cleanIdMap<T>(
  raw: unknown,
  read: (entry: unknown) => T | null,
): Record<string, T> {
  const out = Object.create(null) as Record<string, T>;
  if (!isPlainRecord(raw)) return out;
  // Hacker c11: for-in + early break — Object.keys(100k) allocates a huge array first.
  let n = 0;
  for (const id in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    if (DANGEROUS_KEYS.has(id)) continue;
    if (typeof id !== "string" || id.length === 0) continue;
    if (n >= POSE_HOLD_MAX_IDS) break;
    const entry = read(raw[id]);
    if (entry == null) continue;
    out[id] = entry;
    n++;
  }
  return out;
}

function readFocusHold(entry: unknown): FocusPoseHold | null {
  if (!isPlainRecord(entry)) return null;
  return {
    pulseMul: numField(entry.pulseMul, 1),
    driftMul: clamp01(numField(entry.driftMul, 1)),
  };
}

function readCharacterHold(entry: unknown): CharacterPoseHold | null {
  if (!isPlainRecord(entry)) return null;
  return {
    loco: clamp01(numField(entry.loco, 0)),
    lookYaw: numField(entry.lookYaw, 0),
  };
}

function readBreadcrumb(raw: unknown): BreadcrumbPoseHold {
  const b = createBreadcrumbPoseHold();
  if (!isPlainRecord(raw)) return b;
  b.amount = clamp01(numField(raw.amount, 0));
  b.target = numField(raw.target, 0) >= 0.5 ? 1 : 0;
  b.focusId =
    typeof raw.focusId === "string" && raw.focusId.length > 0 ? raw.focusId : null;
  return b;
}

function readNodeOpen(raw: unknown): NodeOpenPoseHold {
  const n = createNodeOpenPoseHold();
  if (!isPlainRecord(raw)) return n;
  n.amount = clamp01(numField(raw.amount, 0));
  n.target = numField(raw.target, 0) >= 0.5 ? 1 : 0;
  return n;
}

function readSceneTx(raw: unknown): SceneTransitionPoseHold {
  const s = createSceneTransitionPoseHold();
  if (!isPlainRecord(raw)) return s;
  s.progress = clamp01(numField(raw.progress, 0));
  s.target = numField(raw.target, 0) >= 0.5 ? 1 : 0;
  s.fromId = normalizeSceneId(raw.fromId as string | null | undefined);
  s.toId = normalizeSceneId(raw.toId as string | null | undefined);
  return s;
}

/**
 * Sanitize any bag-shaped value in place when possible, else rebuild.
 * Safe after JSON round-trip / sessionStorage tampering (c10).
 */
export function sanitizeMotionPoseBag(bag: unknown): MotionPoseBag {
  if (!isPlainRecord(bag)) return createMotionPoseBag();
  const out = createMotionPoseBag();
  // Always pin current version (foreign/stale versions are accepted as "best effort"
  // field reads, never as a signal to trust nested shapes).
  out.version = POSE_HOLD_VERSION;
  out.focusById = cleanIdMap(bag.focusById, readFocusHold);
  out.characterById = cleanIdMap(bag.characterById, readCharacterHold);
  out.breadcrumb = readBreadcrumb(bag.breadcrumb);
  out.nodeOpen = readNodeOpen(bag.nodeOpen);
  out.sceneTx = readSceneTx(bag.sceneTx);
  return out;
}

/** Parse sessionStorage / JSON text into a sanitized bag. Never throws. */
export function parseMotionPoseBag(raw: unknown): MotionPoseBag {
  if (raw == null) return createMotionPoseBag();
  if (typeof raw === "string") {
    try {
      return sanitizeMotionPoseBag(JSON.parse(raw));
    } catch {
      return createMotionPoseBag();
    }
  }
  return sanitizeMotionPoseBag(raw);
}

/**
 * Restore focus holds only for ids still present in `live`.
 * Stale ids (removed bots/nodes) are ignored — never inserted into live.
 */
export function restoreFocusPosesForKnownIds(
  live: Map<string, FocusEaseState>,
  holds: Readonly<Record<string, FocusPoseHold>>,
): void {
  if (!holds || typeof holds !== "object") return;
  for (const id of Object.keys(holds)) {
    if (DANGEROUS_KEYS.has(id)) continue;
    const state = live.get(id);
    if (!state) continue;
    const h = holds[id];
    if (!h) continue;
    restoreFocusPose(state, h);
  }
}

/** Restore character holds only for ids still present in `live`. */
export function restoreCharacterPosesForKnownIds(
  live: Map<string, CharacterMotionState>,
  holds: Readonly<Record<string, CharacterPoseHold>>,
): void {
  if (!holds || typeof holds !== "object") return;
  for (const id of Object.keys(holds)) {
    if (DANGEROUS_KEYS.has(id)) continue;
    const state = live.get(id);
    if (!state) continue;
    const h = holds[id];
    if (!h) continue;
    restoreCharacterPose(state, h);
  }
}
