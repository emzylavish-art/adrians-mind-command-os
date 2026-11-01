import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/** Watercolor parchment plaque for constellation lore cards. */
export const LorePlaqueShader = {
  name: "LorePlaqueShader",
  uniforms: {
    uBase: { value: [0.10, 0.12, 0.20] as [number, number, number] },
    uInk: { value: [0.93, 0.95, 1.0] as [number, number, number] },
    uAccent: { value: [0.49, 0.76, 1.0] as [number, number, number] },
    uTime: { value: 0 },
    uPaper: { value: 0.22 },
    uWash: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormalW;
    void main() {
      vUv = uv;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBase;
    uniform vec3 uInk;
    uniform vec3 uAccent;
    uniform float uTime;
    uniform float uPaper;
    uniform float uWash;
    varying vec2 vUv;
    varying vec3 vNormalW;
    ${GLSL_HASH_NOISE}
    void main() {
      // parchment field
      float fiber = paintFbm(vUv * vec2(14.0, 22.0) + uTime * 0.02);
      float grain = (paintNoise(vUv * 110.0) - 0.5) * uPaper;
      vec3 parchment = mix(uBase, uBase * 1.35 + vec3(0.08, 0.06, 0.02), fiber * uWash);
      parchment += grain;
      // ink frame brush
      float frame = smoothstep(0.04, 0.02, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
      parchment = mix(parchment, uAccent * 0.55 + parchment * 0.45, frame * 0.85);
      // soft vignette wash
      float vig = smoothstep(0.95, 0.25, length(vUv - 0.5));
      parchment = mix(parchment * 0.82, parchment, vig);
      // title band
      float band = smoothstep(0.78, 0.82, vUv.y) * smoothstep(0.96, 0.90, vUv.y);
      parchment = mix(parchment, mix(parchment, uInk * 0.15 + uAccent * 0.35, 0.55), band);
      float alpha = 0.94;
      gl_FragColor = vec4(parchment, alpha);
    }
  `,
};
