import * as THREE from "three";
import { sanitizeFinite, sanitizeShaderTime, sanitizePainterColor, PAINTER_IDLE_RGB } from "./paper-grain.ts";
import { WatercolorStarShader } from "../shaders/watercolor-star.ts";
import { PAINTER_SHADER_PRECISION } from "../shaders/glsl-noise.ts";
import {
  applyPainterOutputSafeFlags,
  sanitizeStarHalo,
  sanitizeStarGrain,
  starMatteFromStatus,
  PAINTER_MATTE_DEFAULT,
  painterPigmentFromStatusColor,
  sanitizePainterEmissive,
  PAINTER_EMISSIVE_MAX,
} from "./painter-output.ts";

/** Real bot/lane health tones that drive pigment granulation (no fabricated activity). */
export type StarHealthTone = "healthy" | "stalled" | "blocked" | "idle";

/** Pigment granulation by real health — blocked settles heaviest; idle stays fine. */
export const STAR_GRAIN_BY_HEALTH: Record<StarHealthTone, number> = {
  healthy: 0.2,
  stalled: 0.3,
  blocked: 0.42,
  idle: 0.12,
};

export function starGrainFromHealth(health?: StarHealthTone | string | null, idle?: boolean): number {
  if (health === "healthy" || health === "stalled" || health === "blocked" || health === "idle") {
    return STAR_GRAIN_BY_HEALTH[health];
  }
  // Wired path often only passes idle boolean from bot.health === "idle"
  if (idle === true) return STAR_GRAIN_BY_HEALTH.idle;
  if (idle === false) return STAR_GRAIN_BY_HEALTH.healthy;
  return STAR_GRAIN_BY_HEALTH.healthy;
}

export type StarSurfaceOptions = {
  color?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  grain?: number;
  stroke?: number;
  /** Brush-stroke corona; defaults from emissive (real status). */
  halo?: number;
  /** Real bot health — drives default uGrain when `grain` omitted. */
  health?: StarHealthTone | string;
  /**
   * c21: bloom-safe corona matte 0..1 (1 = soft-cap under Light bloom).
   * Omit → PAINTER_MATTE_DEFAULT; pair with idle via createBotStar.
   */
  matte?: number;
  /** When true, treat as idle for default matte (quieter corona). */
  idle?: boolean;
  /**
   * HACKER (c13): force identity-tint fallback material (tests / known-bad GLSL).
   * Records `userData.painterMaterialMeta.compileError` — never silent black.
   */
  forceFallback?: boolean;
};

export type PainterMaterialMeta = {
  compileError: string | null;
  fallback: boolean;
};

function cloneUniforms(src: typeof WatercolorStarShader.uniforms) {
  return {
    uColor: { value: new THREE.Color(...src.uColor.value) },
    uEmissive: { value: src.uEmissive.value as number },
    uTime: { value: 0 },
    uGrain: { value: src.uGrain.value as number },
    uStroke: { value: src.uStroke.value as number },
    uHalo: { value: src.uHalo.value as number },
    uMatte: {
      value: (src as { uMatte?: { value: number } }).uMatte?.value ?? PAINTER_MATTE_DEFAULT,
    },
  };
}

function starFallbackMaterial(color: THREE.Color, reason: string): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    name: "StarWatercolorMaterialFallback",
    uniforms: {
      uColor: { value: color.clone() },
      uEmissive: { value: 0.5 },
      uTime: { value: 0 },
      uGrain: { value: 0 },
      uStroke: { value: 0 },
      uHalo: { value: 0 },
      uMatte: { value: 1 },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uEmissive;
      void main() {
        vec3 c = uColor * (0.55 + uEmissive * 0.45);
        c = clamp(c, 0.0, 0.98);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    transparent: true,
    depthWrite: true,
    precision: PAINTER_SHADER_PRECISION,
  });
  applyPainterOutputSafeFlags(mat, { transparent: true, premultipliedAlpha: false });
  const meta: PainterMaterialMeta = { compileError: reason, fallback: true };
  mat.userData.painterMaterialMeta = meta;
  return mat;
}

function applyColor(
  target: THREE.Color,
  color: unknown,
  userData: Record<string, unknown>,
): void {
  // c26: map status/UI hex → watercolor pigment (desat pure neon / soft-cap channels)
  const pig = painterPigmentFromStatusColor(color as THREE.ColorRepresentation, {
    fallback: new THREE.Color(PAINTER_IDLE_RGB[0], PAINTER_IDLE_RGB[1], PAINTER_IDLE_RGB[2]),
  });
  target.copy(pig.color);
  if (!pig.ok) {
    userData.starColorError = pig.reason;
  } else {
    delete userData.starColorError;
  }
  userData.painterPigmentSatIn = pig.satIn;
}

/** Watercolor ShaderMaterial for bot/star nodes (mediump for iOS/WebGL1). */
export function createStarWatercolorMaterial(
  opts: StarSurfaceOptions = {},
): THREE.ShaderMaterial {
  const idle = new THREE.Color(PAINTER_IDLE_RGB[0], PAINTER_IDLE_RGB[1], PAINTER_IDLE_RGB[2]);
  if (opts.forceFallback) {
    const { color } = sanitizePainterColor(opts.color, PAINTER_IDLE_RGB);
    return starFallbackMaterial(color, "forceFallback");
  }
  try {
    const uniforms = cloneUniforms(WatercolorStarShader.uniforms);
    const userData: Record<string, unknown> = {};
    if (opts.color != null) {
      applyColor(uniforms.uColor.value, opts.color, userData);
    }
    if (opts.emissiveIntensity != null) {
      uniforms.uEmissive.value = sanitizePainterEmissive(opts.emissiveIntensity, 0.85);
    }
    if (opts.grain != null) {
      uniforms.uGrain.value = sanitizeStarGrain(opts.grain, 0.22);
    } else {
      // c15: default granulation from real health / idle (neutral healthy if unknown)
      uniforms.uGrain.value = starGrainFromHealth(opts.health, opts.idle);
    }
    if (opts.stroke != null) uniforms.uStroke.value = sanitizeFinite(opts.stroke, 0.55, 0, 1);
    const em = uniforms.uEmissive.value as number;
    if (opts.halo != null) {
      uniforms.uHalo.value = sanitizeStarHalo(opts.halo, 0.55);
    } else {
      // Neutral default from real emissive — idle/low → quiet halo; active → stronger
      // c21: clamp to 0..1 (was 1.5 HDR) so bloom-safe path stays honest
      uniforms.uHalo.value = sanitizeStarHalo(0.2 + em * 0.55, 0.55);
    }
    uniforms.uMatte.value = starMatteFromStatus(opts.idle, opts.matte);
    // Empty vertex/fragment would black-hole the mesh — guard before construct
    if (!WatercolorStarShader.vertexShader?.trim() || !WatercolorStarShader.fragmentShader?.trim()) {
      throw new Error("star-shader-empty");
    }
    const mat = new THREE.ShaderMaterial({
      name: "StarWatercolorMaterial",
      uniforms,
      vertexShader: WatercolorStarShader.vertexShader,
      fragmentShader: WatercolorStarShader.fragmentShader,
      transparent: true,
      depthWrite: true,
      // HACKER (c7): force mediump — highp fails to compile on some iOS Safari / WebGL1 GPUs
      precision: PAINTER_SHADER_PRECISION,
    });
    Object.assign(mat.userData, userData);
    mat.userData.painterMaterialMeta = { compileError: null, fallback: false } satisfies PainterMaterialMeta;
    // HACKER (c21): toneMapped:false + premultipliedAlpha for painted watercolor
    applyPainterOutputSafeFlags(mat, { transparent: true, premultipliedAlpha: true });
    return mat;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const { color } = sanitizePainterColor(opts.color, PAINTER_IDLE_RGB);
    // Prefer idle tint over black/invisible when construct fails
    return starFallbackMaterial(color.r === 0 && color.g === 0 && color.b === 0 ? idle : color, reason);
  }
}

/** Procedural brush-tick star sprite (canvas, no external asset). */
export function createStarSpriteTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.85)");
  g.addColorStop(0.55, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(size / 2, size / 2);
    ctx.lineTo(size / 2 + Math.cos(a) * size * 0.44, size / 2 + Math.sin(a) * size * 0.44);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function tickStarMaterial(mat: THREE.ShaderMaterial, timeSeconds: number): void {
  if (mat.uniforms["uTime"]) mat.uniforms["uTime"].value = sanitizeShaderTime(timeSeconds);
}

/** Update star pigment from a health color without reallocating the material. */
export function setStarHalo(mat: THREE.ShaderMaterial, halo: number): void {
  if (mat.uniforms["uHalo"]) {
    mat.uniforms["uHalo"].value = sanitizeStarHalo(halo, 0.55);
  }
  (mat.userData as { haloLocked?: boolean }).haloLocked = true;
}

/** Override pigment granulation (locks auto-sync from health/emissive). */
export function setStarGrain(mat: THREE.ShaderMaterial, grain: number): void {
  if (mat.uniforms["uGrain"]) {
    mat.uniforms["uGrain"].value = sanitizeStarGrain(grain, 0.22);
  }
  (mat.userData as { grainLocked?: boolean }).grainLocked = true;
}

/** c21: bloom-safe corona matte (locks). */
export function setStarMatte(mat: THREE.ShaderMaterial, matte: number): void {
  if (mat.uniforms["uMatte"]) {
    mat.uniforms["uMatte"].value = sanitizeFinite(matte, PAINTER_MATTE_DEFAULT, 0, 1);
  }
  (mat.userData as { matteLocked?: boolean }).matteLocked = true;
}

export function setStarWatercolorColor(
  mat: THREE.ShaderMaterial,
  color: THREE.ColorRepresentation,
  emissiveIntensity?: number,
): void {
  if (mat.uniforms["uColor"]) {
    applyColor(mat.uniforms["uColor"].value as THREE.Color, color, mat.userData as Record<string, unknown>);
  }
  if (emissiveIntensity != null && mat.uniforms["uEmissive"]) {
    // c26: Motion pulse.emissive can exceed 1 — clamp for watercolor (was 0..3)
    const em = sanitizePainterEmissive(emissiveIntensity, 0.85);
    mat.uniforms["uEmissive"].value = em;
    // Keep halo honest to real status emissive unless locked
    if (mat.uniforms["uHalo"] && !(mat.userData as { haloLocked?: boolean }).haloLocked) {
      mat.uniforms["uHalo"].value = sanitizeStarHalo(0.2 + em * 0.55, 0.55);
    }
    if (mat.uniforms["uMatte"] && !(mat.userData as { matteLocked?: boolean }).matteLocked) {
      mat.uniforms["uMatte"].value = starMatteFromStatus(em < 0.4);
    }
    // c15: quiet granulation when idle/low emissive; richer pigment when active — unless locked
    if (mat.uniforms["uGrain"] && !(mat.userData as { grainLocked?: boolean }).grainLocked) {
      mat.uniforms["uGrain"].value = starGrainFromHealth(undefined, em < 0.4);
    }
  }
}
