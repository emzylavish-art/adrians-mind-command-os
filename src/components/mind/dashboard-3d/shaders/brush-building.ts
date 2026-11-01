import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Watercolor / ink-wash building facade for city flyover.
 * Window panes light from real uProgress (litFloors/floors); wash/flicker uses uTime
 * (freeze via tickPainterlyKit reducedMotion — never fabricate occupancy).
 */
export const BrushBuildingShader = {
  name: "BrushBuildingShader",
  uniforms: {
    uBase: { value: [0.12, 0.16, 0.28] as [number, number, number] },
    uAccent: { value: [0.49, 0.76, 1.0] as [number, number, number] },
    uFloors: { value: 8 },
    uProgress: { value: 0.6 },
    uTime: { value: 0 },
    uPaper: { value: 0.18 },
    /** Warm window wash strength 0..1 (driven from real progress; 0 = dark shell). */
    uWindowGlow: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vPosLocal;
    void main() {
      vUv = uv;
      vPosLocal = position;
      vNormalW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBase;
    uniform vec3 uAccent;
    uniform float uFloors;
    uniform float uProgress;
    uniform float uTime;
    uniform float uPaper;
    uniform float uWindowGlow;
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vPosLocal;
    ${GLSL_HASH_NOISE}
    void main() {
      float floors = clamp(max(uFloors, 1.0), 1.0, 128.0);
      float progress = clamp(uProgress, 0.0, 1.0);
      float glow = clamp(uWindowGlow, 0.0, 1.5);

      // Floor bands + column grid → window cells
      float fy = fract(vUv.y * floors);
      float fx = fract(vUv.x * max(floor(floors * 0.55), 2.0));
      float floorBand = step(0.14, fy) * step(fy, 0.86);
      float colBand = step(0.18, fx) * step(fx, 0.82);
      float windowCell = floorBand * colBand;

      // Which floors are lit from real progress (bottom→top fill)
      float litFloor = step(vUv.y, progress);
      // Soft wash bloom inside lit panes (ink pooling at sill)
      float pane = windowCell * litFloor;
      float sill = smoothstep(0.14, 0.28, fy) * (1.0 - smoothstep(0.72, 0.86, fy));
      float wash = paintFbm(vUv * vec2(5.5, floors * 0.5) + uTime * 0.025);
      float ink = smoothstep(0.22, 0.82, wash);
      // Gentle flicker only in lit windows — amplitude from real glow; uTime frozen under reduced-motion
      float flicker = 0.92 + 0.08 * sin(uTime * 2.7 + vUv.y * 17.0 + paintNoise(vUv * 8.0) * 6.2831);

      vec3 shell = uBase;
      vec3 warm = mix(uAccent, vec3(1.0, 0.86, 0.55), 0.35); // paper-lamp warmth
      vec3 lit = mix(uAccent, warm, 0.55) * (0.55 + ink * 0.55) * flicker;
      lit = mix(lit, warm * 1.15, sill * pane * 0.45);

      vec3 col = mix(shell, lit, pane * glow * (0.55 + ink * 0.45));
      // Unlit floors keep quiet brush texture
      float unlitWash = paintFbm(vUv * vec2(4.0, floors * 0.4));
      col = mix(col, shell * (0.9 + unlitWash * 0.15), (1.0 - litFloor) * 0.35);

      float grain = (paintNoise(vUv * 120.0) - 0.5) * uPaper;
      float streak = paintNoise(vec2(vUv.x * 40.0, vUv.y * 2.0 + uTime * 0.02));
      col += (streak - 0.5) * 0.06;
      col += grain;

      float nlen2 = dot(vNormalW, vNormalW);
      vec3 nw = nlen2 > 1e-10 ? vNormalW * inversesqrt(nlen2) : vec3(0.0, 0.0, 1.0);
      float rim = pow(1.0 - abs(dot(nw, vec3(0.0, 0.0, 1.0))), 1.8);
      col = mix(col, uAccent * 0.85, rim * 0.2);
      // Progress crown: top lit band gets a soft glow edge (still progress-driven)
      float crown = smoothstep(progress - 0.04, progress, vUv.y) * step(vUv.y, progress + 0.02);
      col += warm * crown * pane * glow * 0.25;

      gl_FragColor = vec4(clamp(col, 0.0, 1.2), 1.0);
    }
  `,
};
