import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Soft watercolor lane nebula (replaces MeshBasicMaterial tint spheres).
 * Sphere UVs + view-facing soft edge; health-tinted ink wash; no derivatives.
 *
 * c14: `uPool` pigment pooling from real lane health (blocked pools heavier;
 * healthy stays light). Time animation uses a period-continuous sin/cos orbit
 * so sanitizeShaderTime wrap seams do not pop the wash.
 */
export const LaneNebulaShader = {
  name: "LaneNebulaShader",
  uniforms: {
    uHealth: { value: [0.24, 0.84, 0.55] as [number, number, number] },
    uTime: { value: 0 },
    uOpacity: { value: 0.28 },
    uWash: { value: 0.65 },
    /** Pigment pooling strength from real lane health (0..1.5). Neutral ~0.45. */
    uPool: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vObj;
    varying vec3 vView;
    void main() {
      vObj = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vView = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uHealth;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uWash;
    uniform float uPool;
    varying vec3 vObj;
    varying vec3 vView;
    ${GLSL_HASH_NOISE}
    void main() {
      // Sphere verts sit on r≈1 — do NOT soft-falloff by length(vObj) (that zeroed alpha).
      // Limb from view-facing normal; ink wash on object-space UV.
      float vlen2 = dot(vView, vView);
      vec3 vn = vlen2 > 1e-10 ? vView * inversesqrt(vlen2) : vec3(0.0, 0.0, 1.0);
      float olen2 = dot(vObj, vObj);
      vec3 on = olen2 > 1e-10 ? vObj * inversesqrt(olen2) : vec3(0.0, 1.0, 0.0);
      float facing = abs(dot(on, -vn));
      // Soft silhouette: brighter face-on, feathered rim (replaces flat MeshBasic disk)
      float limb = smoothstep(0.05, 0.55, facing);
      float rim = pow(1.0 - facing, 1.6);
      vec2 uv = vObj.xz * 1.6 + vObj.y * 0.55;
      // c14: period-continuous orbit (PAINTER_TIME_PERIOD=600) — no wrap-seam pop
      float ang = uTime * 0.010472; // 2π/600
      vec2 tOrbit = vec2(sin(ang), cos(ang * 0.93));
      float wash = paintFbm(uv + tOrbit * 0.85);
      float streak = paintNoise(uv * 3.5 + tOrbit.yx * 1.2);
      float pool = clamp(uPool, 0.0, 1.5);
      float pigment = mix(0.4, 1.0, smoothstep(0.15, 0.9, wash)) * (0.7 + streak * 0.3);
      // Health-driven pooling: darker puddles where wash settles at the limb
      float puddle = smoothstep(0.2, 0.75, wash) * smoothstep(0.15, 0.55, rim + (1.0 - facing) * 0.35);
      pigment = mix(pigment, pigment * (0.55 + pool * 0.35), puddle * pool);
      vec3 col = uHealth * (0.35 + pigment * uWash);
      col += uHealth * rim * (0.35 + pool * 0.35); // pooled rim ink scales with health pool
      col = mix(col, uHealth * 0.28, puddle * pool * 0.55);
      col += (paintNoise(uv * 22.0 + tOrbit) - 0.5) * 0.06;
      float alpha = uOpacity * (limb * (0.5 + pigment * 0.55) + rim * (0.3 + pool * 0.15) + puddle * pool * 0.12);
      alpha = clamp(alpha, 0.0, 0.82);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
    }
  `,
};
