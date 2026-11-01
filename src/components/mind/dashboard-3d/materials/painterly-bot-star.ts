import * as THREE from "three";
import type { PainterlyKit } from "./use-painterly-kit.ts";
import { setStarWatercolorColor, type StarSurfaceOptions } from "./star-surface.ts";
import { sanitizeFinite } from "./paper-grain.ts";

export type PainterlyBotStarOptions = StarSurfaceOptions & {
  /** When idle, lower emissive (mirrors prior MeshStandardMaterial behavior). */
  idle?: boolean;
};

export type PainterlyBotStarBundle = {
  /** Watercolor ShaderMaterial for the bot sphere mesh. */
  meshMaterial: THREE.ShaderMaterial;
  /** Additive glow sprite material bound to kit.starSpriteTexture. */
  glowMaterial: THREE.SpriteMaterial;
  /** Apply a new health color without recreating materials. */
  setColor: (color: THREE.ColorRepresentation, emissiveIntensity?: number) => void;
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
  const emissive =
    opts.emissiveIntensity != null
      ? opts.emissiveIntensity
      : idle
        ? 0.25
        : 0.9;
  const meshMaterial = kit.createStarMaterial({
    color: opts.color,
    emissiveIntensity: emissive,
    grain: opts.grain,
    stroke: opts.stroke,
  });
  const glowMaterial = new THREE.SpriteMaterial({
    map: kit.starSpriteTexture,
    color: opts.color != null ? opts.color : 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  kit.bindSharedTexture(glowMaterial, "starSprite");
  const setColor = (color: THREE.ColorRepresentation, emissiveIntensity?: number) => {
    const em =
      emissiveIntensity != null ? sanitizeFinite(emissiveIntensity, 0.85, 0, 3) : undefined;
    setStarWatercolorColor(meshMaterial, color, em);
    glowMaterial.color.set(color);
  };
  return { meshMaterial, glowMaterial, setColor };
}
