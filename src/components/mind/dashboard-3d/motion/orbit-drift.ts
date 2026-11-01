/** Soft orbital drift around a home position — writes into reusable xyz out. */
import { finiteOr, finiteXyz, sanitizeTime } from "./sanitize.ts";

export type Xyz = { x: number; y: number; z: number };

export type OrbitDriftOpts = {
  /** Radians/sec around Y. Default 0.08. */
  yawSpeed?: number;
  /** Vertical bob amplitude. Default 0.12. */
  bobAmp?: number;
  /** Horizontal radius amp as fraction of distance to origin, or absolute if radius set. */
  radialAmp?: number;
  /** Absolute radial amp override. */
  radius?: number;
};

const DEFAULTS = {
  yawSpeed: 0.08,
  bobAmp: 0.12,
  radialAmp: 0.04,
};

/**
 * Drift a star around its base position. When reducedMotion, copies base → out.
 * out must be a preallocated {x,y,z}. NaN bases collapse to 0; NaN time freezes at base.
 */
export function sampleOrbitDrift(
  out: Xyz,
  base: Readonly<Xyz>,
  tSeconds: number,
  phase: number,
  reducedMotion: boolean,
  opts: OrbitDriftOpts = {},
): Xyz {
  const safeBase = finiteXyz(base.x, base.y, base.z);
  if (reducedMotion || !Number.isFinite(tSeconds)) {
    out.x = safeBase.x;
    out.y = safeBase.y;
    out.z = safeBase.z;
    return out;
  }
  const yawSpeed = finiteOr(opts.yawSpeed ?? DEFAULTS.yawSpeed, DEFAULTS.yawSpeed);
  const bobAmp = finiteOr(opts.bobAmp ?? DEFAULTS.bobAmp, DEFAULTS.bobAmp);
  const radial = finiteOr(
    opts.radius ?? Math.hypot(safeBase.x, safeBase.z) * (opts.radialAmp ?? DEFAULTS.radialAmp),
    0,
  );
  const t = sanitizeTime(tSeconds);
  const ph = finiteOr(phase, 0);
  const ang = t * yawSpeed + ph;
  out.x = safeBase.x + Math.cos(ang) * radial;
  out.z = safeBase.z + Math.sin(ang) * radial;
  out.y = safeBase.y + Math.sin(t * (yawSpeed * 1.7) + ph * 1.3) * bobAmp;
  return out;
}
