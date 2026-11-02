import { GLSL_HASH_NOISE } from "./glsl-noise.ts";

/**
 * Painterly card/sprite for Imagine-generated people, characters, and scenes.
 * Samples uImage when uHasImage > 0.5; otherwise a procedural wash fallback
 * (missing/loading art stays readable, never a blank/black quad).
 * c22: uFocus drives paper bevel / deckle lift (eased on CPU); uQuality cheapens
 * grain under high DPR (fill-rate tier).
 * c23: uAspect (image w/h) letterboxes content — deckle/bevel follow content UV;
 * bars stay neutral wash (no stretch of extreme/non-square maps).
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
    /** Eased focus 0..1 — paper bevel / deckle when >0 (camera lane sets target). */
    uFocus: { value: 0 },
    /** 1 = full grain; 0 = cheap DPR path (fewer noise taps). */
    uQuality: { value: 1 },
    /** Image width/height (finite). 1 = square / missing → full-card content. */
    uAspect: { value: 1 },
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
    uniform float uFocus;
    uniform float uQuality;
    uniform float uAspect;
    varying vec2 vUv;
    ${GLSL_HASH_NOISE}
    void main() {
      vec2 uv = vUv;
      float foc = clamp(uFocus, 0.0, 1.0);
      float qual = clamp(uQuality, 0.0, 1.0);

      // c23: letterbox content rect from real image aspect (contain in UV)
      float imgA = clamp(uAspect, 0.0625, 16.0);
      if (!(imgA > 0.0)) imgA = 1.0;
      vec2 contentSize = imgA >= 1.0 ? vec2(1.0, 1.0 / imgA) : vec2(imgA, 1.0);
      if (uHasImage < 0.5) contentSize = vec2(1.0);
      vec2 contentLo = 0.5 - 0.5 * contentSize;
      vec2 contentHi = 0.5 + 0.5 * contentSize;
      vec2 contentSpan = max(contentSize, vec2(1e-4));
      vec2 contentUv = (uv - contentLo) / contentSpan;
      float inContent = step(contentLo.x, uv.x) * step(uv.x, contentHi.x)
                      * step(contentLo.y, uv.y) * step(uv.y, contentHi.y);

      // Card silhouette (outer soft edge) + content edge for deckle when imaged
      float edgeDistCard = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float edgeDistContent = min(
        min(uv.x - contentLo.x, contentHi.x - uv.x),
        min(uv.y - contentLo.y, contentHi.y - uv.y)
      );
      float edgeDist = uHasImage > 0.5
        ? mix(edgeDistCard, max(edgeDistContent, 0.0), inContent)
        : edgeDistCard;

      float bleedNoise = paintFbm(uv * 9.0 + uTime * 0.04);
      float bleedCut = mix(0.012, 0.085, clamp(uBleed, 0.0, 1.0));
      bleedCut = mix(bleedCut, bleedCut * 0.7, foc * 0.55);
      float softEdge = smoothstep(bleedCut, bleedCut + 0.05 + bleedNoise * 0.04, edgeDistCard);

      // Fallback wash (letterbox bars + missing art)
      float fiber = paintFbm(uv * vec2(11.0, 17.0) + uTime * 0.03);
      vec3 wash = mix(uWash, uWash * 1.4 + uAccent * 0.25, fiber * 0.65);
      wash += (paintNoise(uv * 80.0) - 0.5) * 0.08;
      if (uLoading > 0.5 && uHasImage < 0.5) {
        float pulse = 0.5 + 0.5 * sin(uTime * 2.4);
        wash = mix(wash, wash * 1.15 + uAccent * 0.18, pulse * 0.35);
      }

      vec3 pigment = wash;
      float imgAchan = 1.0;
      if (uHasImage > 0.5 && inContent > 0.5) {
        vec4 img = texture2D(uImage, clamp(contentUv, 0.0, 1.0));
        pigment = mix(wash, img.rgb, clamp(img.a, 0.0, 1.0));
        imgAchan = max(img.a, 0.15);
      }

      // Paper grain — cheap path under low uQuality (high DPR / 4K fill-rate)
      float grain;
      if (uHasPaper > 0.5 && qual > 0.35) {
        vec3 g = texture2D(uPaperMap, uv * 2.7 + uTime * 0.01).rgb;
        grain = (g.r - 0.5) * uGrain;
      } else if (qual > 0.35) {
        grain = (paintNoise(uv * 110.0 + uTime * 0.05) - 0.5) * uGrain;
      } else {
        grain = (paintNoise(uv * 36.0) - 0.5) * uGrain * 0.45;
      }
      pigment += grain;

      // Brush-stroke frame / bevel follow content edge when imaged
      float frameEdge = uHasImage > 0.5 ? max(edgeDistContent, 0.0) : edgeDistCard;
      float frameBand = smoothstep(0.07, 0.015, frameEdge) * inContent;
      if (uHasImage < 0.5) frameBand = smoothstep(0.07, 0.015, edgeDistCard);
      float stroke = paintFbm(uv * 22.0 + vec2(0.0, uTime * 0.06));
      frameBand *= mix(0.55, 1.0, stroke) * clamp(uFrame, 0.0, 1.0) * mix(1.0, 1.35, foc);
      pigment = mix(pigment, mix(pigment, uAccent * 0.55 + pigment * 0.45, 0.85), frameBand);

      // c22/c23: paper bevel / deckle lift on content rim when focused
      float bevelEdge = uHasImage > 0.5 ? max(edgeDistContent, 0.0) : edgeDistCard;
      float bevel = smoothstep(0.11, 0.025, bevelEdge) * (1.0 - smoothstep(0.0, 0.09, bevelEdge));
      if (uHasImage > 0.5) bevel *= inContent;
      vec3 bevelHi = mix(pigment * 1.12, uAccent * 0.55 + vec3(0.12, 0.12, 0.14), 0.4);
      pigment = mix(pigment, bevelHi, bevel * foc * 0.85);
      float well = smoothstep(0.18, 0.06, bevelEdge) * foc * 0.22;
      if (uHasImage > 0.5) well *= inContent;
      pigment *= (1.0 - well * 0.35);

      float alpha = softEdge * uOpacity * mix(1.0, imgAchan, inContent * step(0.5, uHasImage));
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(pigment, alpha);
    }
  `,
};
