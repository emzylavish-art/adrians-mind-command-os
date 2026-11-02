import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Soft watercolor lane nebula (replaces MeshBasicMaterial tint spheres).
 * Sphere UVs + view-facing soft edge; health-tinted ink wash; no derivatives.
 */
export const LaneNebulaShader = {
  name: "LaneNebulaShader",
  uniforms: {
    uHealth: { value: [0.24, 0.84, 0.55] as [number, number, number] },
    uTime: { value: 0 },
    uOpacity: { value: 0.28 },
    uWash: { value: 0.65 },
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
      float wash = paintFbm(uv + vec2(uTime * 0.03, -uTime * 0.02));
      float streak = paintNoise(uv * 3.5 + uTime * 0.04);
      float pigment = mix(0.4, 1.0, smoothstep(0.15, 0.9, wash)) * (0.7 + streak * 0.3);
      vec3 col = uHealth * (0.35 + pigment * uWash);
      col += uHealth * rim * 0.45; // pooled rim ink
      col += (paintNoise(uv * 22.0) - 0.5) * 0.06;
      float alpha = uOpacity * (limb * (0.5 + pigment * 0.55) + rim * 0.35);
      alpha = clamp(alpha, 0.0, 0.78);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
    }
  `,
};
