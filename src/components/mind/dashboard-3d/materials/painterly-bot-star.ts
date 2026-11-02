import * as THREE from "three";
import type { PainterlyKit } from "./use-painterly-kit.ts";
import {
  setStarWatercolorColor,
  setStarHalo,
  setStarGrain,
  setStarMatte,
  starGrainFromHealth,
  type StarSurfaceOptions,
  type StarHealthTone,
} from "./star-surface.ts";
import { sanitizeFinite, PAINTER_IDLE_RGB } from "./paper-grain.ts";
import {
  applyPainterOutputSafeFlags,
  starMatteFromStatus,
  sanitizeStarHalo,
  PAINTER_MATTE_DEFAULT,
  painterPigmentFromStatusColor,
  painterGlowColorScale,
  sanitizePainterEmissive,
} from "./painter-output.ts";

export type PainterlyBotStarOptions = StarSurfaceOptions & {
  /** When idle, lower emissive (mirrors prior MeshStandardMaterial behavior). */
  idle?: boolean;
  /** Real bot health tone — drives pigment granulation when `grain` omitted. */
  health?: StarHealthTone | string;
};

export type PainterlyBotStarBundle = {
  /** Watercolor ShaderMaterial for the bot sphere mesh. */
  meshMaterial: THREE.ShaderMaterial;
  /** Additive glow sprite material bound to kit.starSpriteTexture. */
  glowMaterial: THREE.SpriteMaterial;
  /** Apply a new health color without recreating materials. */
  setColor: (color: THREE.ColorRepresentation, emissiveIntensity?: number) => void;
  /** Override brush-stroke halo (locks auto-sync from emissive). */
  setHalo: (halo: number) => void;
  /** Override pigment granulation (locks auto-sync from health). */
  setGrain: (grain: number) => void;
  /** Override bloom-safe corona matte (locks). */
  setMatte: (matte: number) => void;
};

/**
 * One-line adopt helper for universe-scene bot stars (currently MeshStandardMaterial).
 *
 * ```ts
 * const star = kit.createBotStar({ color: HEALTH_COLOR[bot.health], idle: bot.health === "idle" });
 * mesh.material = star.meshMaterial;
 * glow.material = star.glowMaterial;
 * // on health change: star.setColor(HEALTH_COLOR[h], h === "idle" ? 0.25 : 0.9);
 * ```
 */
export function createPainterlyBotStar(
  kit: PainterlyKit,
  opts: PainterlyBotStarOptions = {},
): PainterlyBotStarBundle {
  const idle = !!opts.idle;
  const health = opts.health;
  const emissive = sanitizePainterEmissive(
    opts.emissiveIntensity != null ? opts.emissiveIntensity : idle ? 0.25 : 0.85,
    idle ? 0.25 : 0.85,
  );
  // Halo from real idle/active status (neutral default — no fabricated pulse)
  const halo =
    opts.halo != null
      ? sanitizeStarHalo(opts.halo, 0.55)
      : idle
        ? 0.18
        : sanitizeStarHalo(0.2 + emissive * 0.55, 0.65);
  // c15: pigment granulation from real health (blocked settles heaviest)
  const grain =
    opts.grain != null
      ? opts.grain
      : starGrainFromHealth(health, idle);
  const matte = starMatteFromStatus(idle, opts.matte);
  const meshMaterial = kit.createStarMaterial({
    color: opts.color,
    emissiveIntensity: emissive,
    grain,
    stroke: opts.stroke,
    halo,
    health,
    idle,
    matte,
    forceFallback: opts.forceFallback,
  });
  // c26: pigment from status (not raw neon) + matte-scaled additive glow
  const glowPig = painterPigmentFromStatusColor(opts.color ?? 0xffffff, {
    fallback: new THREE.Color(PAINTER_IDLE_RGB[0], PAINTER_IDLE_RGB[1], PAINTER_IDLE_RGB[2]),
  });
  const glowScale = painterGlowColorScale(matte);
  const glowMaterial = new THREE.SpriteMaterial({
    map: kit.starSpriteTexture,
    color: glowPig.color.clone().multiplyScalar(glowScale),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    // Quieter than c21 — additive stack of many nodes saturates otherwise
    opacity: sanitizeFinite(0.38 + (1 - matte) * 0.28, 0.5, 0.15, 0.85),
  });
  // HACKER (c21): additive sprites must not be toneMapped (double wash / HDR spike)
  applyPainterOutputSafeFlags(glowMaterial, { transparent: true, premultipliedAlpha: true });
  if (kit.starSpriteTexture && "colorSpace" in kit.starSpriteTexture) {
    try {
      kit.starSpriteTexture.colorSpace = THREE.SRGBColorSpace;
    } catch {
      /* */
    }
  }
  if (!glowPig.ok) {
    (glowMaterial.userData as { starColorError?: string }).starColorError = glowPig.reason ?? "color-bad";
  }
  (glowMaterial.userData as { painterMatte?: number }).painterMatte = matte;
  (glowMaterial.userData as { painterPigmentBase?: THREE.Color }).painterPigmentBase = glowPig.color.clone();
  kit.bindSharedTexture(glowMaterial, "starSprite");
  const applyGlowFromStatus = (color: THREE.ColorRepresentation) => {
    const mm =
      (glowMaterial.userData as { painterMatte?: number }).painterMatte ?? PAINTER_MATTE_DEFAULT;
    const pig = painterPigmentFromStatusColor(color, {
      fallback: new THREE.Color(PAINTER_IDLE_RGB[0], PAINTER_IDLE_RGB[1], PAINTER_IDLE_RGB[2]),
    });
    (glowMaterial.userData as { painterPigmentBase?: THREE.Color }).painterPigmentBase = pig.color.clone();
    glowMaterial.color.copy(pig.color).multiplyScalar(painterGlowColorScale(mm));
    if (!pig.ok) {
      (glowMaterial.userData as { starColorError?: string }).starColorError = pig.reason ?? "color-bad";
    } else {
      delete (glowMaterial.userData as { starColorError?: string }).starColorError;
    }
  };
  const setColor = (color: THREE.ColorRepresentation, emissiveIntensity?: number) => {
    // c26 HACKER: never pass raw pulse.emissive>1 or copy full neon onto additive glow
    const em =
      emissiveIntensity != null ? sanitizePainterEmissive(emissiveIntensity, 0.85) : undefined;
    setStarWatercolorColor(meshMaterial, color, em);
    applyGlowFromStatus(color);
  };
  const setHalo = (h: number) => setStarHalo(meshMaterial, h);
  const setGrain = (g: number) => setStarGrain(meshMaterial, g);
  const setMatte = (m: number) => {
    setStarMatte(meshMaterial, m);
    const mm = sanitizeFinite(m, PAINTER_MATTE_DEFAULT, 0, 1);
    (glowMaterial.userData as { painterMatte?: number }).painterMatte = mm;
    glowMaterial.opacity = sanitizeFinite(0.38 + (1 - mm) * 0.28, 0.5, 0.15, 0.85);
    const base =
      (glowMaterial.userData as { painterPigmentBase?: THREE.Color }).painterPigmentBase ??
      glowMaterial.color.clone();
    glowMaterial.color.copy(base).multiplyScalar(painterGlowColorScale(mm));
  };
  return { meshMaterial, glowMaterial, setColor, setHalo, setGrain, setMatte };
}
