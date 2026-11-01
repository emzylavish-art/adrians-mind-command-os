import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/** Vertex + fragment for watercolor star / bot-node spheres. */
export const WatercolorStarShader = {
  name: "WatercolorStarShader",
  uniforms: {
    uColor: { value: [0.24, 0.84, 0.55] as [number, number, number] },
    uEmissive: { value: 0.85 },
    uTime: { value: 0 },
    uGrain: { value: 0.22 },
    uStroke: { value: 0.55 },
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
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      float fres = pow(1.0 - max(dot(normalize(vNormalW), vec3(0.0, 0.0, 1.0)), 0.0), 2.2);
      // brush stroke rings
      float rings = paintFbm(vUv * 18.0 + uTime * 0.08);
      float stroke = smoothstep(0.35, 0.75, rings) * uStroke;
      float grain = (paintNoise(vUv * 90.0 + uTime * 0.05) - 0.5) * uGrain;
      vec3 pigment = uColor * (0.55 + uEmissive * 0.65);
      pigment += pigment * stroke * 0.35;
      pigment += grain;
      // rim wash
      pigment = mix(pigment, pigment * 1.25 + vec3(0.15, 0.18, 0.35), fres * 0.55);
      float alpha = 0.92 + stroke * 0.08;
      gl_FragColor = vec4(pigment, alpha);
    }
  `,
};
