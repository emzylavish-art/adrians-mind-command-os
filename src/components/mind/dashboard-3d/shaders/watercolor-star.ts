import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Watercolor star / bot-node spheres.
 * c12: painted brush-stroke halo (`uHalo`) driven from real status via createBotStar
 * (idle → low halo; active → stronger ink corona). No fabricated activity.
 * c15: anisotropic pigment granulation (`uGrain`) — fiber-stretched, paintWrap-safe
 * mediump sampling; strength from real bot health via createBotStar / setStarGrain.
 */
export const WatercolorStarShader = {
  name: "WatercolorStarShader",
  uniforms: {
    uColor: { value: [0.24, 0.84, 0.55] as [number, number, number] },
    uEmissive: { value: 0.85 },
    uTime: { value: 0 },
    uGrain: { value: 0.22 },
    uStroke: { value: 0.55 },
    /** Brush-stroke corona strength 0..1.5 (from real idle/health emissive). */
    uHalo: { value: 0.55 },
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
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      float nlen2 = dot(vNormalW, vNormalW);
      vec3 nw = nlen2 > 1e-10 ? vNormalW * inversesqrt(nlen2) : vec3(0.0, 0.0, 1.0);
      float fres = pow(1.0 - max(dot(nw, vec3(0.0, 0.0, 1.0)), 0.0), 2.2);
      // brush stroke rings + soft ink bloom
      float rings = paintFbm(vUv * 18.0 + uTime * 0.08);
      float stroke = smoothstep(0.35, 0.75, rings) * uStroke;
      float bloom = smoothstep(0.15, 0.85, paintFbm(vUv * 6.0 - uTime * 0.05)) * 0.22;
      // c15: anisotropic pigment granulation — fiber stretch + mediump-safe wrap
      // (avoid raw vUv*90 floor banding on weak GPUs; paintWrap keeps domain finite)
      vec2 gUv = paintWrap(vUv * vec2(22.0, 48.0) + vec2(uTime * 0.03, -uTime * 0.025));
      float gFine = paintNoise(gUv);
      float gFiber = paintFbm(paintWrap(vUv * vec2(5.5, 16.0) + uTime * 0.018));
      float grain = (gFine - 0.5) * uGrain * (0.5 + gFiber * 0.95);
      vec3 pigment = uColor * (0.55 + uEmissive * 0.65);
      pigment += pigment * stroke * 0.35;
      pigment += uColor * bloom;
      pigment += grain;
      // c12: painted brush-stroke halo — ragged corona on the rim from real uHalo
      float haloAmt = clamp(uHalo, 0.0, 1.5);
      float haloNoise = paintFbm(vUv * 10.0 + vec2(uTime * 0.06, -uTime * 0.04));
      float haloRing = smoothstep(0.15, 0.55, fres) * (0.55 + haloNoise * 0.55);
      float haloStroke = smoothstep(0.4, 0.85, paintNoise(vUv * 28.0 + uTime * 0.1));
      vec3 haloCol = uColor * (0.85 + uEmissive * 0.4) + vec3(0.12, 0.14, 0.28) * fres;
      pigment = mix(pigment, pigment + haloCol * haloRing * haloStroke, haloAmt * 0.85);
      pigment = mix(pigment, pigment * 1.25 + vec3(0.15, 0.18, 0.35), fres * 0.45);
      float alpha = clamp(0.9 + stroke * 0.08 + fres * haloAmt * 0.12, 0.0, 1.0);
      gl_FragColor = vec4(clamp(pigment, 0.0, 1.6), alpha);
    }
  `,
};
