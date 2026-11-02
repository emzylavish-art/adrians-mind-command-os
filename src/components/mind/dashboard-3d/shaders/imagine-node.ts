import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Painterly card/sprite for Imagine-generated people, characters, and scenes.
 * Samples uImage when uHasImage > 0.5; otherwise a procedural wash fallback
 * (missing/loading art stays readable, never a blank/black quad).
 */
export const ImagineNodeShader = {
  name: "ImagineNodeShader",
  uniforms: {
    uImage: { value: null as unknown },
    uPaperMap: { value: null as unknown },
    uHasImage: { value: 0 },
    uHasPaper: { value: 0 },
    uAccent: { value: [0.49, 0.76, 1.0] as [number, number, number] },
    uWash: { value: [0.10, 0.12, 0.20] as [number, number, number] },
    uTime: { value: 0 },
    uGrain: { value: 0.28 },
    uBleed: { value: 0.55 },
    uFrame: { value: 0.72 },
    uOpacity: { value: 0.95 },
    /** 1 while TextureLoader in flight — honest pulse; 0 when missing/settled. */
    uLoading: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uImage;
    uniform sampler2D uPaperMap;
    uniform float uHasImage;
    uniform float uHasPaper;
    uniform vec3 uAccent;
    uniform vec3 uWash;
    uniform float uTime;
    uniform float uGrain;
    uniform float uBleed;
    uniform float uFrame;
    uniform float uOpacity;
    uniform float uLoading;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      vec2 uv = vUv;
      // Watercolor edge bleed: soft irregular mask that frays toward the border
      float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float bleedNoise = paintFbm(uv * 9.0 + uTime * 0.04);
      float bleedCut = mix(0.012, 0.085, clamp(uBleed, 0.0, 1.0));
      float softEdge = smoothstep(bleedCut, bleedCut + 0.05 + bleedNoise * 0.04, edgeDist);

      // Fallback wash when Imagine asset is missing / still loading (lane+health tint via uniforms)
      float fiber = paintFbm(uv * vec2(11.0, 17.0) + uTime * 0.03);
      vec3 wash = mix(uWash, uWash * 1.4 + uAccent * 0.25, fiber * 0.65);
      wash += (paintNoise(uv * 80.0) - 0.5) * 0.08;
      // Honest loading pulse — never invents a portrait; just breathes the wash
      if (uLoading > 0.5 && uHasImage < 0.5) {
        float pulse = 0.5 + 0.5 * sin(uTime * 2.4);
        wash = mix(wash, wash * 1.15 + uAccent * 0.18, pulse * 0.35);
      }

      vec3 pigment = wash;
      float imgA = 1.0;
      if (uHasImage > 0.5) {
        vec4 img = texture2D(uImage, uv);
        pigment = mix(wash, img.rgb, clamp(img.a, 0.0, 1.0));
        imgA = max(img.a, 0.15);
      }

      // Paper grain overlay (shared kit DataTexture when bound; procedural otherwise)
      float grain;
      if (uHasPaper > 0.5) {
        vec3 g = texture2D(uPaperMap, uv * 2.7 + uTime * 0.01).rgb;
        grain = (g.r - 0.5) * uGrain;
      } else {
        grain = (paintNoise(uv * 110.0 + uTime * 0.05) - 0.5) * uGrain;
      }
      pigment += grain;

      // Brush-stroke frame (ink wash around the rim)
      float frameBand = smoothstep(0.07, 0.015, edgeDist);
      float stroke = paintFbm(uv * 22.0 + vec2(0.0, uTime * 0.06));
      frameBand *= mix(0.55, 1.0, stroke) * clamp(uFrame, 0.0, 1.0);
      pigment = mix(pigment, mix(pigment, uAccent * 0.55 + pigment * 0.45, 0.85), frameBand);

      float alpha = softEdge * uOpacity * imgA;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(pigment, alpha);
    }
  `,
};
