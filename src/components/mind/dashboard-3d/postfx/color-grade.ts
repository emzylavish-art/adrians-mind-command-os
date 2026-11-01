import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { HealthTone } from "../atmosphere/health-tone.ts";
import { AMBIENT_RGB, normalizeHealthTone } from "../atmosphere/health-tone.ts";

export type ColorGradeTuning = {
  tint: readonly [number, number, number];
  contrast: number;
  saturation: number;
  vignette: number;
};

export const GRADE_BY_TONE: Record<HealthTone, ColorGradeTuning> = {
  healthy: {
    tint: AMBIENT_RGB.healthy,
    contrast: 1.05,
    saturation: 1.08,
    vignette: 0.22,
  },
  stalled: {
    tint: AMBIENT_RGB.stalled,
    contrast: 1.08,
    saturation: 0.95,
    vignette: 0.28,
  },
  blocked: {
    tint: AMBIENT_RGB.blocked,
    contrast: 1.12,
    saturation: 0.9,
    vignette: 0.34,
  },
  idle: {
    tint: AMBIENT_RGB.idle,
    contrast: 1.0,
    saturation: 0.92,
    vignette: 0.2,
  },
};

export function colorGradeParamsForTone(tone: HealthTone): ColorGradeTuning {
  const g = GRADE_BY_TONE[normalizeHealthTone(tone)];
  return {
    tint: [...g.tint] as [number, number, number],
    contrast: g.contrast,
    saturation: g.saturation,
    vignette: g.vignette,
  };
}

/** Lightweight health-tint color grade (no painterly grain — universe owns that). */
export const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    tint: { value: [0.42, 0.48, 0.62] as [number, number, number] },
    contrast: { value: 1.0 },
    saturation: { value: 0.92 },
    vignette: { value: 0.2 },
    mixAmount: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 tint;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    uniform float mixAmount;
    varying vec2 vUv;

    vec3 applySat(vec3 c, float s) {
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      return mix(vec3(l), c, s);
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;
      c = (c - 0.5) * contrast + 0.5;
      c = applySat(c, saturation);
      c = mix(c, c * tint * 1.15, mixAmount);
      float vig = smoothstep(1.15, 0.35, length(vUv - 0.5));
      c *= mix(1.0 - vignette, 1.0, vig);
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

export type ColorGradeHandle = {
  pass: ShaderPass;
  update: (tone: HealthTone) => void;
  dispose: () => void;
};

export function createColorGradePass(tone: HealthTone = "idle"): ColorGradeHandle {
  const pass = new ShaderPass(ColorGradeShader);
  let disposed = false;
  const apply = (next: HealthTone) => {
    if (disposed) return;
    const g = GRADE_BY_TONE[normalizeHealthTone(next)];
    const u = pass.uniforms as {
      tint: { value: [number, number, number] };
      contrast: { value: number };
      saturation: { value: number };
      vignette: { value: number };
    };
    u.tint.value = [g.tint[0], g.tint[1], g.tint[2]];
    u.contrast.value = g.contrast;
    u.saturation.value = g.saturation;
    u.vignette.value = g.vignette;
  };
  apply(tone);
  return {
    pass,
    update: apply,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      pass.dispose();
    },
  };
}
