import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/** Watercolor parchment plaque for constellation lore cards (+ optional text atlas). */
export const LorePlaqueShader = {
  name: "LorePlaqueShader",
  uniforms: {
    uBase: { value: [0.10, 0.12, 0.20] as [number, number, number] },
    uInk: { value: [0.93, 0.95, 1.0] as [number, number, number] },
    uAccent: { value: [0.49, 0.76, 1.0] as [number, number, number] },
    uTime: { value: 0 },
    uPaper: { value: 0.22 },
    uWash: { value: 0.45 },
    /** 1 = fresh lock ink; fades toward ~0.25 as claimed_at ages (never raw age). */
    uInkDensity: { value: 0.85 },
    /** c20: stack lift 0..1 — soft paper shade so overlapping cards read layered. */
    uStackLift: { value: 0 },
    uTextMap: { value: null as unknown },
    uHasText: { value: 0 },
  },
  vertexShader: /* glsl */ `
    #include <logdepthbuf_pars_vertex>
    varying vec2 vUv;
    varying vec3 vNormalW;
    void main() {
      vUv = uv;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    #include <logdepthbuf_pars_fragment>
    uniform vec3 uBase;
    uniform vec3 uInk;
    uniform vec3 uAccent;
    uniform float uTime;
    uniform float uPaper;
    uniform float uWash;
    uniform float uInkDensity;
    uniform float uStackLift;
    uniform sampler2D uTextMap;
    uniform float uHasText;
    varying vec2 vUv;
    varying vec3 vNormalW;
    ${GLSL_HASH_NOISE}
    void main() {
      #include <logdepthbuf_fragment>
      // parchment field
      float fiber = paintFbm(vUv * vec2(14.0, 22.0) + uTime * 0.02);
      float dens = clamp(uInkDensity, 0.0, 1.0);
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
      parchment = mix(parchment, mix(parchment, uInk * 0.15 + uAccent * 0.35, 0.55 * dens), band);
      // procedural canvas glyph atlas (painterly ink) — body text region
      if (uHasText > 0.5) {
        vec4 inkSample = texture2D(uTextMap, vUv);
        float inkA = clamp(inkSample.a, 0.0, 1.0) * dens;
        vec3 inkCol = mix(uInk * 0.35 + uAccent * 0.15, inkSample.rgb, 0.85);
        parchment = mix(parchment, inkCol, inkA * 0.92);
      }
      // Layered-paper shade: higher stack cards lift slightly warmer (no fabricated content)
      float lift = clamp(uStackLift, 0.0, 1.0);
      parchment = mix(parchment, parchment * vec3(1.04, 1.02, 0.98) + uAccent * 0.04, lift * 0.35);
      float alpha = 0.94;
      gl_FragColor = vec4(parchment, alpha);
    }
  `,
};
