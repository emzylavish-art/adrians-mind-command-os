/**
 * #112 (light c111): bloom bright-pass anti-alias prefilter.
 *
 * With the #110 resolution budget the bright target (UnrealBloomPass's first
 * half-res target) covers ~3 drawing-buffer px per texel per axis at
 * 4480×2520 (stock: 2), and up to ~9.5 under #109 backoff tiers. The stock LuminosityHighPass takes
 * ONE bilinear tap per bright texel (covers 2×2 source texels), so sub-texel
 * highlights (node speculars, comet heads ≤ 3 px) are caught on some frames
 * and missed on others → bloom shimmer while the camera orbits.
 *
 * Fix: when the footprint is wider than 2 source texels, take an n×n grid of
 * bilinear taps spread evenly across the footprint (n = ceil(f) up to f = 4,
 * ceil(f/2) beyond, max 4), threshold each tap, and average. Pure box average for LDR (painter stars ≤ ~0.98 keep
 * full energy — c21 constraint); only HDR luma above 1 is Karis-weighted
 * (1 / (1 + max(0, luma - 1))) so a single blown-out pixel can't firefly.
 * At footprint ≤ 2 (no budget downscale) the stock single tap runs unchanged.
 */

/** Max taps per axis (16 total) — bright target is ≤ ~0.3 MP under #110. */
export const PREFILTER_MAX_TAPS = 4;

export type PrefilterTaps = {
  /** Taps per axis (1 = stock single tap). */
  n: number;
  /** Tap offsets from the bright-texel centre, in source texels. */
  offsets: number[];
};

/** Source texels per bright texel on one axis; junk → 2 (stock footprint). */
export function prefilterFootprint(srcEdge: number, brightEdge: number): number {
  if (!(Number.isFinite(srcEdge) && srcEdge >= 1 && Number.isFinite(brightEdge) && brightEdge >= 1)) return 2;
  return srcEdge / brightEdge;
}

/** Tap layout for a footprint `f` (source texels per bright texel). */
export function prefilterTaps(f: number): PrefilterTaps {
  if (!Number.isFinite(f) || f <= 2 + 1e-3) return { n: 1, offsets: [0] };
  // ≤ 4 texels: one tap per source texel (≈1-texel spacing tiles best); wider: 2-texel spacing.
  const n = Math.max(1, Math.min(PREFILTER_MAX_TAPS, Math.ceil((f <= 4 ? f : f / 2) - 0.05) /* rounding slack: 4480/1491 = 3.004 → 3 */));
  const spacing = f / n;
  const offsets: number[] = [];
  for (let k = 0; k < n; k++) offsets.push((k - (n - 1) / 2) * spacing);
  return { n, offsets };
}

export type PrefilterUniforms = {
  uPrefilterTaps: { value: number };
  uPrefilterSpacing: { value: [number, number] | { x: number; y: number; set?: (x: number, y: number) => unknown } };
  uSrcTexel: { value: [number, number] | { x: number; y: number; set?: (x: number, y: number) => unknown } };
};

/** Fresh uniform values (Vector2-like plain objects work with three). */
export function prefilterUniformDefaults(Vec2: new (x: number, y: number) => { x: number; y: number }) {
  return {
    uPrefilterTaps: { value: 1 },
    uPrefilterSpacing: { value: new Vec2(0, 0) },
    uSrcTexel: { value: new Vec2(1, 1) },
  };
}

export type PrefilterState = { nx: number; ny: number; n: number; spacingX: number; spacingY: number };

/**
 * Compute the prefilter for a source (readBuffer) and bright target size and
 * write it into `uniforms` when they carry the prefilter slots. Returns the
 * layout (n = 1 → stock path). Uniform-less materials are left untouched.
 */
export function applyPrefilter(
  uniforms: Record<string, { value: unknown }> | null | undefined,
  srcW: number,
  srcH: number,
  brightW: number,
  brightH: number,
): PrefilterState {
  const fx = prefilterFootprint(srcW, brightW);
  const fy = prefilterFootprint(srcH, brightH);
  const tx = prefilterTaps(fx);
  const ty = prefilterTaps(fy);
  // One square grid (shader loops n×n): the larger axis decides; spacing per axis.
  const n = Math.max(tx.n, ty.n);
  const spacingX = n > 1 ? fx / n : 0;
  const spacingY = n > 1 ? fy / n : 0;
  const state = { nx: tx.n, ny: ty.n, n, spacingX, spacingY };
  if (!uniforms || !uniforms.uPrefilterTaps) return state;
  uniforms.uPrefilterTaps.value = n;
  const sp = uniforms.uPrefilterSpacing?.value as { set?: (x: number, y: number) => unknown; x: number; y: number };
  if (sp && typeof sp.set === "function") sp.set(spacingX, spacingY);
  else if (sp) ((sp.x = spacingX), (sp.y = spacingY));
  const st = uniforms.uSrcTexel?.value as { set?: (x: number, y: number) => unknown; x: number; y: number };
  const isx = Number.isFinite(srcW) && srcW >= 1 ? 1 / srcW : 1;
  const isy = Number.isFinite(srcH) && srcH >= 1 ? 1 / srcH : 1;
  if (st && typeof st.set === "function") st.set(isx, isy);
  else if (st) ((st.x = isx), (st.y = isy));
  return state;
}

/**
 * GLSL chunk: needs tDiffuse, defaultColor, defaultOpacity,
 * luminosityThreshold, smoothWidth declared before it. Provides
 * `lightBrightPass(vec2 uv)`.
 */
export const PREFILTER_GLSL = /* glsl */ `
  uniform float uPrefilterTaps;
  uniform vec2 uPrefilterSpacing;
  uniform vec2 uSrcTexel;

  vec4 lightBrightTap(vec2 uv) {
    vec4 texel = texture2D(tDiffuse, uv);
    float v = luminance(texel.xyz);
    float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
    return mix(vec4(defaultColor.rgb, defaultOpacity), texel, alpha);
  }

  vec4 lightBrightPass(vec2 uv) {
    if (uPrefilterTaps < 1.5) return lightBrightTap(uv);
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    float hc = (uPrefilterTaps - 1.0) * 0.5;
    for (int j = 0; j < ${PREFILTER_MAX_TAPS}; j++) {
      if (float(j) >= uPrefilterTaps) break;
      for (int i = 0; i < ${PREFILTER_MAX_TAPS}; i++) {
        if (float(i) >= uPrefilterTaps) break;
        vec2 o = (vec2(float(i), float(j)) - hc) * uPrefilterSpacing * uSrcTexel;
        vec4 t = lightBrightTap(uv + o);
        // LDR box average; Karis-weight only HDR excess (anti-firefly).
        float w = 1.0 / (1.0 + max(0.0, luminance(t.rgb) - 1.0));
        acc += t * w;
        wsum += w;
      }
    }
    return acc / max(wsum, 1e-4);
  }
`;

/** Stock LuminosityHighPass with the prefilter (drop-in fragment shader). */
export const PREFILTER_HIGHPASS_FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 defaultColor;
  uniform float defaultOpacity;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  varying vec2 vUv;
  ${PREFILTER_GLSL}
  void main() {
    gl_FragColor = lightBrightPass(vUv);
  }
`;
