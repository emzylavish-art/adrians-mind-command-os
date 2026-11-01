/** Soft orbital drift around a home position — writes into reusable xyz out. */

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
 * out must be a preallocated {x,y,z}.
 */
export function sampleOrbitDrift(
  out: Xyz,
  base: Readonly<Xyz>,
  tSeconds: number,
  phase: number,
  reducedMotion: boolean,
  opts: OrbitDriftOpts = {},
): Xyz {
  if (reducedMotion) {
    out.x = base.x;
    out.y = base.y;
    out.z = base.z;
    return out;
  }
  const yawSpeed = opts.yawSpeed ?? DEFAULTS.yawSpeed;
  const bobAmp = opts.bobAmp ?? DEFAULTS.bobAmp;
  const radial =
    opts.radius ??
    Math.hypot(base.x, base.z) * (opts.radialAmp ?? DEFAULTS.radialAmp);
  const ang = tSeconds * yawSpeed + phase;
  out.x = base.x + Math.cos(ang) * radial;
  out.z = base.z + Math.sin(ang) * radial;
  out.y = base.y + Math.sin(tSeconds * (yawSpeed * 1.7) + phase * 1.3) * bobAmp;
  return out;
}
