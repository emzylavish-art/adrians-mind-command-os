import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Painter c30 — Notion page galaxy spheres (InstancedMesh-safe).
 * Supports USE_INSTANCING + instanceColor so Dashboard can replace MeshBasic.
 * Quieter than bot stars — 60+ pages must not LED-wash the sky.
 */
export const GalaxyPageShader = {
  name: "GalaxyPageShader",
  uniforms: {
    uColor: { value: [0.55, 0.68, 0.95] as [number, number, number] },
    uEmissive: { value: 0.45 },
    uTime: { value: 0 },
    uGrain: { value: 0.28 },
    uStroke: { value: 0.4 },
    uHalo: { value: 0.35 },
    uMatte: { value: 0.9 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormalW;
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    // InstancedMesh.instanceColor — Three binds when define is set
    attribute vec3 instanceColor;
    void main() {
      vUv = uv;
      // Three sets USE_INSTANCING when drawing InstancedMesh
      #ifdef USE_INSTANCING
        mat4 im = instanceMatrix;
        vec4 wp = modelMatrix * im * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * mat3(im) * normal);
      #else
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
      #endif
      #ifdef USE_INSTANCING_COLOR
        vInstanceColor = instanceColor;
      #else
        vInstanceColor = vec3(1.0);
      #endif
      // HACKER (c30): NaN instanceColor channels → white multiply (keep uColor)
      if (!(vInstanceColor.r == vInstanceColor.r)) vInstanceColor = vec3(1.0);
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
    uniform float uMatte;
    varying vec3 vNormalW;
    varying vec2 vUv;
    varying vec3 vInstanceColor;
    ${GLSL_HASH_NOISE}
    vec3 bloomSafeClamp(vec3 c, float matte) {
      float m = clamp(matte, 0.0, 1.0);
      float lim = mix(1.2, 0.9, m);
      float maxC = max(max(c.r, c.g), max(c.b, 0.0));
      if (maxC > lim && maxC > 1e-5) c *= lim / maxC;
      return clamp(c, 0.0, lim);
    }
    void main() {
      float nlen2 = dot(vNormalW, vNormalW);
      vec3 nw = nlen2 > 1e-10 ? vNormalW * inversesqrt(nlen2) : vec3(0.0, 0.0, 1.0);
      float fres = pow(1.0 - max(dot(nw, vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
      vec3 base = uColor * vInstanceColor;
      // HACKER (c30): NaN instanceColor → fall back to uColor
      if (!(base.r == base.r && base.g == base.g && base.b == base.b)) base = uColor;
      float em = clamp(uEmissive, 0.0, 1.0);
      float gr = clamp(uGrain, 0.0, 1.0);
      float rings = paintFbm(vUv * 14.0 + uTime * 0.05);
      float stroke = smoothstep(0.4, 0.8, rings) * clamp(uStroke, 0.0, 1.0);
      vec2 gUv = paintWrap(vUv * vec2(18.0, 40.0) + uTime * 0.02);
      float grain = (paintNoise(gUv) - 0.5) * gr * 0.9;
      vec3 pigment = base * (0.5 + em * 0.28);
      pigment += pigment * stroke * 0.35;
      pigment += grain;
      float matte = clamp(uMatte, 0.0, 1.0);
      float haloAmt = clamp(uHalo, 0.0, 1.0) * mix(1.0, 0.65, matte);
      pigment = mix(pigment, pigment + base * fres * 0.35, haloAmt * 0.7);
      pigment = bloomSafeClamp(pigment, matte);
      float alpha = clamp(0.88 + stroke * 0.06 + fres * haloAmt * 0.08, 0.0, 1.0);
      gl_FragColor = vec4(pigment * alpha, alpha);
    }
  `,
};

export const GALAXY_PAGE_DEFAULT_RGB: [number, number, number] = [0.55, 0.68, 0.95];
