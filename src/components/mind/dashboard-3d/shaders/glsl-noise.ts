/** Shared GLSL noise snippets for painter-lane shaders (no external assets). */

/**
 * mediump-safe hash/noise: wrap coords before sin/dot so weak-GPU mediump
 * does not overflow into Inf/NaN (silent black/sparkle).
 */
export const GLSL_HASH_NOISE = /* glsl */ `
vec2 paintWrap(vec2 p) {
  // Keep domain bounded for mediump (~10-bit mantissa)
  return fract(p * 0.0025) * 400.0;
}
float paintHash(vec2 p) {
  vec2 q = paintWrap(p);
  return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453123);
}
float paintNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = paintHash(i);
  float b = paintHash(i + vec2(1.0, 0.0));
  float c = paintHash(i + vec2(0.0, 1.0));
  float d = paintHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float paintFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  // Fixed bound (4) — no dynamic loop length (weak GPU / WebGL1 safe)
  for (int i = 0; i < 4; i++) {
    v += a * paintNoise(paintWrap(p));
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}
`;

export const PAINTER_SHADER_VERSION = "painter-1.2.0";

/** Marker string tests assert is present for mediump hardening. */
export const GLSL_MEDIUMP_GUARD = "paintWrap";
