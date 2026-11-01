/**
 * Dust-field wind gust impulses (Cosmos Motion Bot c13).
 *
 * Brief directional gust when a fleet event fires (comet/landing). Pure helper:
 * impulses superpose into a velocity vector, magnitude is hard-capped, then
 * exponential decay each frame. Reduced-motion → impulses ignored / force zero.
 * 1000 events in one frame cannot exceed GUST_MAX_SPEED.
 * c14: reject non-finite/huge dirs; snap sub-ε residuals; mid RM clears fully.
 */
import { clamp01 } from "./ease.ts";
import { finiteOr, sanitizeDt } from "./sanitize.ts";

export const GUST_MAX_SPEED = 2.5;
export const GUST_DECAY_LAMBDA = 4.2;
export const GUST_IMPULSE = 0.85;

export type WindGustState = {
  vx: number;
  vy: number;
  vz: number;
};

export type WindGustSample = {
  x: number;
  y: number;
  z: number;
  /** Current speed magnitude after cap. */
  speed: number;
};

export type WindGustOpts = {
  maxSpeed?: number;
  decayLambda?: number;
  impulse?: number;
};

const EMPTY_GUST_OPTS: WindGustOpts = Object.freeze({});

export function createWindGustState(): WindGustState {
  return { vx: 0, vy: 0, vz: 0 };
}

export function createWindGustSample(): WindGustSample {
  return { x: 0, y: 0, z: 0, speed: 0 };
}

function capVelocity(state: WindGustState, maxSpeed: number): void {
  const sp = Math.hypot(state.vx, state.vy, state.vz);
  if (!Number.isFinite(sp) || sp <= maxSpeed) {
    if (!Number.isFinite(state.vx)) state.vx = 0;
    if (!Number.isFinite(state.vy)) state.vy = 0;
    if (!Number.isFinite(state.vz)) state.vz = 0;
    return;
  }
  if (sp > maxSpeed && sp > 0) {
    const s = maxSpeed / sp;
    state.vx *= s;
    state.vy *= s;
    state.vz *= s;
  }
}

/**
 * Add a directional impulse. Direction is normalized (zero/NaN dir → no-op).
 * Reduced-motion ignores the impulse. Magnitude always re-capped after add.
 */
export function impulseWindGust(
  state: WindGustState,
  dx: number,
  dy: number,
  dz: number,
  reducedMotion: boolean,
  strength: number = 1,
  opts: WindGustOpts = EMPTY_GUST_OPTS,
): void {
  if (reducedMotion) return;
  const o = opts ?? EMPTY_GUST_OPTS;
  const maxSpeed = Math.max(0, finiteOr(o.maxSpeed ?? GUST_MAX_SPEED, GUST_MAX_SPEED));
  const impulse = Math.max(0, finiteOr(o.impulse ?? GUST_IMPULSE, GUST_IMPULSE));
  const str = clamp01(finiteOr(strength, 1));
  const x = finiteOr(dx, 0);
  const y = finiteOr(dy, 0);
  const z = finiteOr(dz, 0);
  const len = Math.hypot(x, y, z);
  // Hacker c14: zero / NaN / overflow dirs must not inject Infinity into velocity.
  if (!Number.isFinite(len) || !(len > 1e-8)) return;
  const inv = 1 / len;
  const mag = impulse * str;
  state.vx = finiteOr(state.vx, 0) + x * inv * mag;
  state.vy = finiteOr(state.vy, 0) + y * inv * mag;
  state.vz = finiteOr(state.vz, 0) + z * inv * mag;
  capVelocity(state, maxSpeed);
}

/**
 * Decay gust toward zero; write displacement sample for this frame.
 * Reduced-motion clears state and returns zero.
 */
export function stepWindGust(
  state: WindGustState,
  out: WindGustSample,
  dt: number,
  reducedMotion: boolean,
  opts: WindGustOpts = EMPTY_GUST_OPTS,
): WindGustSample {
  const o = opts ?? EMPTY_GUST_OPTS;
  const maxSpeed = Math.max(0, finiteOr(o.maxSpeed ?? GUST_MAX_SPEED, GUST_MAX_SPEED));
  const lambda = Math.max(0, finiteOr(o.decayLambda ?? GUST_DECAY_LAMBDA, GUST_DECAY_LAMBDA));

  if (reducedMotion) {
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.speed = 0;
    return out;
  }

  const d = sanitizeDt(dt);
  const damp = lambda <= 0 ? 1 : Math.exp(-lambda * d);
  state.vx = finiteOr(state.vx, 0) * damp;
  state.vy = finiteOr(state.vy, 0) * damp;
  state.vz = finiteOr(state.vz, 0) * damp;
  capVelocity(state, maxSpeed);

  // Displacement ≈ velocity * dt (small), then expose velocity as offset scale for dust.
  out.x = state.vx;
  out.y = state.vy;
  out.z = state.vz;
  out.speed = Math.hypot(out.x, out.y, out.z);
  // Hacker c14: long-session decay leaves denormal dust — snap residual to rest.
  if (!Number.isFinite(out.speed) || out.speed < 1e-4) {
    state.vx = 0;
    state.vy = 0;
    state.vz = 0;
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.speed = 0;
  }
  return out;
}
