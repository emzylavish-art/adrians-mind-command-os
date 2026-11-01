import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Ink-wash ribbon for constellation edges (health-tinted).
 * Pair with `buildInkWashRibbon` (materials/ink-wash-edge.ts): uv.x runs along
 * the edge, uv.y across. Weak-GPU safe: no derivatives extension, fixed-bound
 * loops only (paintFbm), all noise coordinates wrapped via paintWrap, uTime is
 * pre-wrapped CPU-side (sanitizeShaderTime) so mediump never overflows.
 */
export const InkWashEdgeShader = {
  name: "InkWashEdgeShader",
  uniforms: {
    uHealth: { value: [0.24, 0.84, 0.55] as [number, number, number] },
    uTime: { value: 0 },
    uInk: { value: 0.65 },
    uPulse: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    // Camera-facing ribbon: position = edge centreline, aTangent = edge direction,
    // aSide = signed half-width. Offset is built in view space so the wash reads
    // from every fly-to angle (a fixed-plane ribbon goes edge-on and vanishes).
    attribute vec3 aTangent;
    attribute float aSide;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 t = mat3(modelViewMatrix) * aTangent;
      vec3 toCam = -mv.xyz;
      vec3 side = cross(t, toCam);
      float len2 = dot(side, side);
      // degenerate (edge points at camera / zero tangent): never normalise a zero vector (NaN on some GPUs)
      side = len2 > 1e-10 ? side * inversesqrt(len2) : vec3(0.0, 1.0, 0.0);
      mv.xyz += side * aSide;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uHealth;
    uniform float uTime;
    uniform float uInk;
    uniform float uPulse;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      float across = abs(vUv.y - 0.5) * 2.0;           // 0 centre .. 1 rim
      // along-edge brush: stretched fbm so strokes read lengthwise
      float along = paintFbm(vec2(vUv.x * 14.0 + uTime * 0.04, vUv.y * 2.5));
      // ragged wet edge: rim position wobbles along the stroke
      float rim = 0.72 + (paintFbm(vec2(vUv.x * 9.0, 3.7)) - 0.5) * 0.35;
      float edgeSoft = 1.0 - smoothstep(rim - 0.18, rim, across);
      // pigment pooling: watercolor darkens where the wash dries at its edge
      float pool = smoothstep(rim - 0.32, rim - 0.06, across) * edgeSoft;
      // dry-brush gaps: high-frequency streaks that skip paper
      float streak = paintNoise(vec2(vUv.x * 60.0, vUv.y * 7.0));
      float dry = smoothstep(0.18, 0.42, streak + along * 0.35);
      // brush lift taper at both ends
      float ends = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
      // flowing pulse bead travelling along the edge (shows link direction)
      float head = fract(uTime * 0.12);
      float d = abs(vUv.x - head);
      float bead = exp(-d * d * 900.0) * (1.0 - across) * uPulse;
      float wash = smoothstep(0.15, 0.85, along);
      vec3 ink = uHealth * (0.40 + wash * uInk);
      ink = mix(ink, uHealth * 0.38, pool * 0.55);      // darker pooled rim
      ink += vec3(1.0, 0.97, 0.9) * bead * 0.9;           // warm paper-white highlight
      ink += (paintNoise(vUv * 80.0) - 0.5) * 0.06;      // paper grain
      float alpha = edgeSoft * ends * (0.22 + wash * 0.55 + pool * 0.25) * mix(0.55, 1.0, dry);
      alpha = clamp(alpha + bead * 0.6, 0.0, 1.0);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(clamp(ink, 0.0, 1.0), alpha);
    }
  `,
};
