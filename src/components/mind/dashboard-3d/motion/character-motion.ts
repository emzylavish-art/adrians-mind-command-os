/**
 * Character idle / walk motion primitives (Cosmos Motion Bot c7).
 *
 * Imagine-zone "characters" are billboard planes (`userData.kind === "character"` per bot
 * portrait, plus scene arts like `scene-agents-walk.webp`). These helpers are generic
 * (id, speed, look-at target) so Dashboard Bot can drive any mesh/sprite without a full
 * skeletal rig — bob, sway, stride bounce, head yaw easing, start/stop blend.
 *
 * Per-id phase from a stable FNV-ish hash so a crowd does not move in lockstep.
 * Reduced-motion → static pose (identity offsets, yaw snapped). Zero hot-path allocation
 * when the caller reuses CharacterSample / CharacterMotionState.
 */
import { clamp01, damp, lerp } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";
import { sharedMotionClock, type MotionClock } from "./motion-clock.ts";

export const CHAR_IDLE_BOB_AMP = 0.04;
export const CHAR_IDLE_BOB_SPEED = 1.7;
export const CHAR_IDLE_BREATH_AMP = 0.02;
export const CHAR_WALK_BOUNCE_AMP = 0.09;
export const CHAR_WALK_SWAY_AMP = 0.05;
export const CHAR_WALK_STRIDE_HZ = 1.85;
export const CHAR_LOOK_LAMBDA = 7;
export const CHAR_LOCOMOTION_LAMBDA = 6;
/** Cap id length hashed per call (very long ids must not burn a frame). */
export const CHAR_PHASE_ID_MAX = 256;

export type CharacterMotionState = {
  /** Eased locomotion weight 0 (idle) → 1 (full walk). */
  loco: number;
  /** Current look yaw (radians, local Y). */
  lookYaw: number;
};

export type CharacterSample = {
  /** Vertical bob/bounce offset. */
  offsetY: number;
  /** Lateral sway offset. */
  offsetX: number;
  /** Forward/back micro offset from stride. */
  offsetZ: number;
  /** Scale Y breath (1 = rest). */
  scaleY: number;
  /** Head/body yaw (radians). */
  yaw: number;
  /** Stride phase 0..1 (for footstep sync etc.). */
  stridePhase: number;
  /** Blended locomotion weight 0..1. */
  loco: number;
};

export type CharacterMotionOpts = {
  /** Desired walk speed scalar; 0 = idle. Default 0. Values capped to [0, 1]. */
  speed?: number;
  /** Desired look-at yaw (radians). Default 0. */
  lookYaw?: number;
  clock?: MotionClock;
  idleBobAmp?: number;
  walkBounceAmp?: number;
  walkSwayAmp?: number;
  strideHz?: number;
};

/** Hacker c8: default `= {}` allocated a fresh object every call. */
const EMPTY_CHAR_OPTS: CharacterMotionOpts = Object.freeze({});

export function createCharacterMotionState(): CharacterMotionState {
  return { loco: 0, lookYaw: 0 };
}

export function createCharacterSample(): CharacterSample {
  return { offsetY: 0, offsetX: 0, offsetZ: 0, scaleY: 1, yaw: 0, stridePhase: 0, loco: 0 };
}

/** Hacker c8: +Infinity → full walk; NaN/-Inf/neg → idle; finite clamped to [0,1]. */
export function sanitizeCharacterSpeed(speed: number): number {
  if (speed === Number.POSITIVE_INFINITY) return 1;
  if (!Number.isFinite(speed) || speed < 0) return 0;
  return speed > 1 ? 1 : speed;
}

/** Stable phase offset in [0, 2π) from an id string (crowd desync). */
export function characterPhaseFromId(id: string | null | undefined): number {
  const raw = id ?? "";
  const s = raw.length > CHAR_PHASE_ID_MAX ? raw.slice(0, CHAR_PHASE_ID_MAX) : raw;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/**
 * Sample idle + walk. `speed` eases into loco; look yaw damps toward target.
 * Reuses `state` + `out`. Unknown/empty id still works (phase 0).
 */
export function stepCharacterMotion(
  state: CharacterMotionState,
  out: CharacterSample,
  id: string | null | undefined,
  tSeconds: number,
  dt: number,
  reducedMotion: boolean,
  opts: CharacterMotionOpts = EMPTY_CHAR_OPTS,
): CharacterSample {
  const speed = sanitizeCharacterSpeed(opts.speed ?? 0);
  const lookTarget = finiteOr(opts.lookYaw ?? 0, 0);
  const phase = characterPhaseFromId(id);
  const clock = opts.clock ?? sharedMotionClock;
  const bobAmp = finiteOr(opts.idleBobAmp ?? CHAR_IDLE_BOB_AMP, CHAR_IDLE_BOB_AMP);
  const bounceAmp = finiteOr(opts.walkBounceAmp ?? CHAR_WALK_BOUNCE_AMP, CHAR_WALK_BOUNCE_AMP);
  const swayAmp = finiteOr(opts.walkSwayAmp ?? CHAR_WALK_SWAY_AMP, CHAR_WALK_SWAY_AMP);
  const strideHz = Math.max(0.05, finiteOr(opts.strideHz ?? CHAR_WALK_STRIDE_HZ, CHAR_WALK_STRIDE_HZ));

  let loco = clamp01(finiteOr(state.loco, 0));
  let yaw = finiteOr(state.lookYaw, 0);

  if (reducedMotion) {
    loco = speed > 0.5 ? 1 : 0;
    yaw = lookTarget;
    state.loco = loco;
    state.lookYaw = yaw;
    out.offsetY = 0;
    out.offsetX = 0;
    out.offsetZ = 0;
    out.scaleY = 1;
    out.yaw = yaw;
    out.stridePhase = 0;
    out.loco = loco;
    return out;
  }

  const d = sanitizeDt(dt);
  loco = damp(loco, speed, CHAR_LOCOMOTION_LAMBDA, d);
  yaw = damp(yaw, lookTarget, CHAR_LOOK_LAMBDA, d);
  state.loco = loco;
  state.lookYaw = yaw;

  const t = clock.map(tSeconds);
  const idleBob = Math.sin(t * CHAR_IDLE_BOB_SPEED + phase) * bobAmp;
  const breath = 1 + Math.sin(t * (CHAR_IDLE_BOB_SPEED * 0.85) + phase * 1.3) * CHAR_IDLE_BREATH_AMP;

  const strideAng = t * strideHz * Math.PI * 2 + phase;
  let stridePhase = (strideAng / (Math.PI * 2)) % 1;
  if (stridePhase < 0) stridePhase += 1;
  const bounce = Math.abs(Math.sin(strideAng)) * bounceAmp;
  const sway = Math.sin(strideAng) * swayAmp;
  const strideZ = Math.sin(strideAng * 2) * (bounceAmp * 0.25);

  out.offsetY = lerp(idleBob, bounce, loco);
  out.offsetX = sway * loco;
  out.offsetZ = strideZ * loco;
  out.scaleY = lerp(breath, 1 + bounce * 0.15, loco);
  out.yaw = yaw;
  out.stridePhase = stridePhase;
  out.loco = loco;
  return out;
}

/** Convenience: idle-only sample (speed forced 0). Not for multi-character hot paths (uses scratch state). */
export function sampleCharacterIdle(
  out: CharacterSample,
  id: string | null | undefined,
  tSeconds: number,
  reducedMotion: boolean,
  opts: Omit<CharacterMotionOpts, "speed"> = EMPTY_CHAR_OPTS,
): CharacterSample {
  idleScratch.loco = 0;
  idleScratch.lookYaw = finiteOr(out.yaw, 0);
  idleOpts.speed = 0;
  idleOpts.lookYaw = opts.lookYaw;
  idleOpts.clock = opts.clock;
  idleOpts.idleBobAmp = opts.idleBobAmp;
  idleOpts.walkBounceAmp = opts.walkBounceAmp;
  idleOpts.walkSwayAmp = opts.walkSwayAmp;
  idleOpts.strideHz = opts.strideHz;
  return stepCharacterMotion(idleScratch, out, id, tSeconds, 0, reducedMotion, idleOpts);
}

const idleScratch: CharacterMotionState = { loco: 0, lookYaw: 0 };
const idleOpts: CharacterMotionOpts = { speed: 0 };
