import * as THREE from "three";
import type { PainterlyKit } from "./use-painterly-kit.ts";
import {
  setStarWatercolorColor,
  setStarHalo,
  setStarGrain,
  starGrainFromHealth,
  type StarSurfaceOptions,
  type StarHealthTone,
} from "./star-surface.ts";
import { sanitizeFinite, sanitizePainterColor, PAINTER_IDLE_RGB } from "./paper-grain.ts";

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
  const emissive =
    opts.emissiveIntensity != null
      ? opts.emissiveIntensity
      : idle
        ? 0.25
        : 0.9;
  // Halo from real idle/active status (neutral default — no fabricated pulse)
  const halo =
    opts.halo != null
      ? opts.halo
      : idle
        ? 0.18
        : sanitizeFinite(0.2 + emissive * 0.55, 0.65, 0, 1.5);
  // c15: pigment granulation from real health (blocked settles heaviest)
  const grain =
    opts.grain != null
      ? opts.grain
      : starGrainFromHealth(health, idle);
  const meshMaterial = kit.createStarMaterial({
    color: opts.color,
    emissiveIntensity: emissive,
    grain,
    stroke: opts.stroke,
    halo,
    health,
    forceFallback: opts.forceFallback,
  });
  const glowSafe = sanitizePainterColor(opts.color ?? 0xffffff, PAINTER_IDLE_RGB);
  const glowMaterial = new THREE.SpriteMaterial({
    map: kit.starSpriteTexture,
    color: glowSafe.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  if (!glowSafe.ok) {
    (glowMaterial.userData as { starColorError?: string }).starColorError = glowSafe.reason ?? "color-bad";
  }
  kit.bindSharedTexture(glowMaterial, "starSprite");
  const setColor = (color: THREE.ColorRepresentation, emissiveIntensity?: number) => {
    const em =
      emissiveIntensity != null ? sanitizeFinite(emissiveIntensity, 0.85, 0, 3) : undefined;
    setStarWatercolorColor(meshMaterial, color, em);
    const g = sanitizePainterColor(color, PAINTER_IDLE_RGB);
    glowMaterial.color.copy(g.color);
    if (!g.ok) {
      (glowMaterial.userData as { starColorError?: string }).starColorError = g.reason ?? "color-bad";
    } else {
      delete (glowMaterial.userData as { starColorError?: string }).starColorError;
    }
  };
  const setHalo = (h: number) => setStarHalo(meshMaterial, h);
  const setGrain = (g: number) => setStarGrain(meshMaterial, g);
  return { meshMaterial, glowMaterial, setColor, setHalo, setGrain };
}
