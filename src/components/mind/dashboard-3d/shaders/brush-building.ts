import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/** Watercolor / ink-wash building facade for city flyover lane. */
export const BrushBuildingShader = {
  name: "BrushBuildingShader",
  uniforms: {
    uBase: { value: [0.12, 0.16, 0.28] as [number, number, number] },
    uAccent: { value: [0.49, 0.76, 1.0] as [number, number, number] },
    uFloors: { value: 8 },
    uProgress: { value: 0.6 },
    uTime: { value: 0 },
    uPaper: { value: 0.18 },
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
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vPosLocal;
    ${GLSL_HASH_NOISE}
    void main() {
      float floors = clamp(max(uFloors, 1.0), 1.0, 128.0);
      float fy = fract(vUv.y * floors);
      float floorBand = step(0.12, fy) * step(fy, 0.88);
      float litFloor = step(vUv.y, clamp(uProgress, 0.0, 1.0));
      float wash = paintFbm(vUv * vec2(6.0, floors * 0.55) + uTime * 0.03);
      float ink = smoothstep(0.25, 0.8, wash);
      float grain = (paintNoise(vUv * 120.0) - 0.5) * uPaper;
      vec3 col = mix(uBase, uAccent, litFloor * floorBand * (0.45 + ink * 0.55));
      // vertical brush streaks
      float streak = paintNoise(vec2(vUv.x * 40.0, vUv.y * 2.0 + uTime * 0.02));
      col += (streak - 0.5) * 0.08;
      col += grain;
      float rim = pow(1.0 - abs(dot(normalize(vNormalW), vec3(0.0, 0.0, 1.0))), 1.8);
      col = mix(col, uAccent * 0.85, rim * 0.25);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
