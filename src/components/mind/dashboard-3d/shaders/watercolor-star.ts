import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Watercolor star / bot-node spheres.
 * c12: painted brush-stroke halo (`uHalo`) driven from real status via createBotStar
 * (idle → low halo; active → stronger ink corona). No fabricated activity.
 * c15: anisotropic pigment granulation (`uGrain`) — fiber-stretched, paintWrap-safe
 * mediump sampling; strength from real bot health via createBotStar / setStarGrain.
 * c21: bloom-safe matte (`uMatte`) — soft-cap corona/pigment so Light UnrealBloom
 * picks up paint instead of HDR fireballs (painter shaders only; no postfx edits).
 */
export const WatercolorStarShader = {
  name: "WatercolorStarShader",
  uniforms: {
    uColor: { value: [0.24, 0.84, 0.55] as [number, number, number] },
    uEmissive: { value: 0.85 },
    uTime: { value: 0 },
    uGrain: { value: 0.22 },
    uStroke: { value: 0.55 },
    /** Brush-stroke corona strength 0..1 (from real idle/health emissive). */
    uHalo: { value: 0.55 },
    /**
     * 0 = legacy HDR headroom (~1.6); 1 = bloom-safe ceiling (~0.98).
     * Light owns bloom — we only matte the paint we emit.
     */
    uMatte: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vPosW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uEmissive;
    uniform float uTime;
    uniform float uGrain;
    uniform float uStroke;
    uniform float uHalo;
    uniform float uMatte;
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    // Soft-cap RGB so max channel ≤ lim (matte blends 1.6 → 0.98)
    vec3 bloomSafeClamp(vec3 c, float matte) {
      float m = clamp(matte, 0.0, 1.0);
      float lim = mix(1.35, 0.92, m); // c26: tighter LED soft-cap under matte
      float maxC = max(max(c.r, c.g), max(c.b, 0.0));
      if (maxC > lim && maxC > 1e-5) c *= lim / maxC;
      return clamp(c, 0.0, lim);
    }
    void main() {
      float nlen2 = dot(vNormalW, vNormalW);
      vec3 nw = nlen2 > 1e-10 ? vNormalW * inversesqrt(nlen2) : vec3(0.0, 0.0, 1.0);
      float fres = pow(1.0 - max(dot(nw, vec3(0.0, 0.0, 1.0)), 0.0), 2.2);
      float rings = paintFbm(vUv * 18.0 + uTime * 0.08);
      float stroke = smoothstep(0.35, 0.75, rings) * uStroke;
      float bloom = smoothstep(0.15, 0.85, paintFbm(vUv * 6.0 - uTime * 0.05)) * 0.22;
      // c15: anisotropic pigment granulation
      vec2 gUv = paintWrap(vUv * vec2(22.0, 48.0) + vec2(uTime * 0.03, -uTime * 0.025));
      float gFine = paintNoise(gUv);
      float gFiber = paintFbm(paintWrap(vUv * vec2(5.5, 16.0) + uTime * 0.018));
      float grain = (gFine - 0.5) * clamp(uGrain, 0.0, 1.0) * (0.5 + gFiber * 0.95);
      // c26/c29: quieter emissive; stronger granulation so wired bots read paint on full dash
      float em = clamp(uEmissive, 0.0, 1.0);
      float gr = clamp(uGrain, 0.0, 1.0);
      vec3 pigment = uColor * (0.44 + em * 0.36);
      pigment += pigment * stroke * 0.48;
      pigment += uColor * bloom * 0.7;
      // c29: paper fiber granulation scaled by real uGrain (health-driven)
      pigment += grain * (1.15 + em * 0.2 + gr * 0.55);
      // subtle cool paper underlay so neon status can't stay LED-flat
      pigment = mix(pigment, pigment * vec3(0.92, 0.96, 1.05) + vec3(0.04, 0.05, 0.08), 0.22 + gr * 0.2);
      // c12/c21: corona — matte softens additive lift so bloom reads paint, not fire
      float matte = clamp(uMatte, 0.0, 1.0);
      float haloAmt = clamp(uHalo, 0.0, 1.0) * mix(1.0, 0.72, matte);
      float haloNoise = paintFbm(vUv * 10.0 + vec2(uTime * 0.06, -uTime * 0.04));
      float haloRing = smoothstep(0.15, 0.55, fres) * (0.55 + haloNoise * 0.55);
      float haloStroke = smoothstep(0.4, 0.85, paintNoise(vUv * 28.0 + uTime * 0.1));
      vec3 haloCol = uColor * (0.7 + em * 0.28) + vec3(0.14, 0.16, 0.28) * fres;
      pigment = mix(pigment, pigment + haloCol * haloRing * haloStroke, haloAmt * 0.85);
      pigment = mix(pigment, pigment * 1.25 + vec3(0.15, 0.18, 0.35), fres * 0.45 * mix(1.0, 0.55, matte));
      pigment = bloomSafeClamp(pigment, matte);
      float alpha = clamp(0.9 + stroke * 0.08 + fres * haloAmt * 0.12, 0.0, 1.0);
      // HACKER (c21): premultiply for transparent path — avoids dark fringes
      gl_FragColor = vec4(pigment * alpha, alpha);
    }
  `,
};
