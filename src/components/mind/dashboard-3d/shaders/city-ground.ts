import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Painterly city plaza ground (c24/c25).
 * Replaces MeshStandardMaterial dark-glass + GridHelper with ink-wash paper,
 * soft wet rings, and fiber — no PBR chrome.
 * c25: uPlazaScale + paintWrap harden extreme plaza / far-from-origin UV precision;
 * uRing<=0 → honest flat wash (no fabricated rings).
 */
export const CityGroundShader = {
  name: "CityGroundShader",
  uniforms: {
    uBase: { value: [0.04, 0.06, 0.12] as [number, number, number] },
    uInk: { value: [0.17, 0.23, 0.40] as [number, number, number] },
    uAccent: { value: [0.49, 0.55, 0.95] as [number, number, number] },
    uTime: { value: 0 },
    uGrain: { value: 0.22 },
    uWet: { value: 0.55 },
    uRing: { value: 0.45 },
    uOpacity: { value: 0.94 },
    /** World plaza radius scale (1 = unit UV; large plazas keep mediump-safe noise). */
    uPlazaScale: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vPos;
    void main() {
      vUv = uv;
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBase;
    uniform vec3 uInk;
    uniform vec3 uAccent;
    uniform float uTime;
    uniform float uGrain;
    uniform float uWet;
    uniform float uRing;
    uniform float uOpacity;
    uniform float uPlazaScale;
    varying vec2 vUv;
    varying vec3 vPos;
    ${GLSL_HASH_NOISE}
    void main() {
      vec2 uv = vUv;
      // c25: wrap scaled UV so extreme plaza / far tiles stay mediump-safe
      float pscale = clamp(uPlazaScale, 0.05, 64.0);
      if (!(pscale > 0.0)) pscale = 1.0;
      vec2 suv = paintWrap(uv * pscale);
      float r = length(uv - 0.5) * 2.0;
      float wet = clamp(uWet, 0.0, 1.0);
      float ringAmt = clamp(uRing, 0.0, 1.0);
      float fiber = paintFbm(suv * vec2(7.0, 11.0) + uTime * 0.02);
      float wash = paintFbm(suv * 3.5 + fiber * 0.3);
      vec3 pigment = mix(uBase, uBase * 1.35 + uInk * 0.35, wash * 0.7);
      pigment = mix(pigment, pigment + uAccent * 0.08, fiber * wet * 0.5);
      // Soft ink rings — skipped when ringAmt==0 (no data / neutral plaza)
      float rings = 0.0;
      if (ringAmt > 0.001) {
        for (int i = 1; i <= 4; i++) {
          float rr = float(i) * 0.22;
          float d = abs(r - rr);
          rings += (1.0 - smoothstep(0.0, 0.035 + wash * 0.02, d)) * (0.55 / float(i));
        }
        rings *= ringAmt * (0.55 + 0.45 * fiber);
        pigment = mix(pigment, mix(pigment, uInk + uAccent * 0.15, 0.75), rings * 0.55);
      }
      float grain = (paintNoise(paintWrap(suv * 90.0) + uTime * 0.04) - 0.5) * uGrain;
      pigment += grain;
      float rim = 1.0 - smoothstep(0.82, 1.05, r);
      float alpha = rim * uOpacity;
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(pigment, alpha);
    }
  `,
};
