/**
 * Painter c27 — fleet plan queue/landing beacons (replaces MeshStandardMaterial ball()).
 * Dashboard owns fleet-plan-layer.ts; this is the adopt surface only.
 */
import * as THREE from "three";
import type { PainterlyKit } from "./use-painterly-kit.ts";
import {
  createPainterlyBotStar,
  type PainterlyBotStarBundle,
  type PainterlyBotStarOptions,
} from "./painterly-bot-star.ts";
import { sanitizeFinite } from "./paper-grain.ts";
import {
  painterPigmentFromStatusColor,
  sanitizePainterEmissive,
  PAINTER_MATTE_DEFAULT,
} from "./painter-output.ts";
import type { StarHealthTone } from "./star-surface.ts";

export const FLEET_BEACON_RADIUS_DEFAULT = 0.4;
export const FLEET_BEACON_RADIUS_MAX = 2.5;
export const FLEET_BEACON_RADIUS_MIN = 0.05;

export type FleetBeaconStatus = "done" | "active" | "queued" | "reached" | "pending";

export type FleetBeaconOptions = PainterlyBotStarOptions & {
  /** Real queue/landing status — drives idle/matte/emissive (no fabricated pulse). */
  status?: FleetBeaconStatus | string;
  /** Landing hop reached flag (alias for status reached/pending). */
  reached?: boolean;
  /** Sphere radius for mesh builders (sanitized). */
  radius?: number;
};

export type PainterlyFleetBeaconBundle = PainterlyBotStarBundle & {
  /** Map queue/landing status onto pigment + emissive without recreating mats. */
  setStatus: (status: FleetBeaconStatus | string, color?: THREE.ColorRepresentation) => void;
  /** Landing hop reached ↔ pending. */
  setReached: (reached: boolean, color?: THREE.ColorRepresentation) => void;
  /** Last sanitized radius (for mesh scale helpers). */
  radius: number;
};

export function sanitizeFleetBeaconRadius(radius: number, fallback = FLEET_BEACON_RADIUS_DEFAULT): number {
  return sanitizeFinite(radius, fallback, FLEET_BEACON_RADIUS_MIN, FLEET_BEACON_RADIUS_MAX);
}

function healthFromStatus(status?: FleetBeaconStatus | string | null): StarHealthTone {
  if (status === "done" || status === "reached") return "healthy";
  if (status === "active") return "stalled";
  if (status === "pending") return "stalled";
  if (status === "queued") return "idle";
  if (status === "healthy" || status === "stalled" || status === "blocked" || status === "idle") {
    return status;
  }
  return "healthy";
}

function idleFromStatus(status?: FleetBeaconStatus | string | null, reached?: boolean): boolean {
  if (reached === false) return true;
  if (status === "queued" || status === "pending" || status === "idle") return true;
  return false;
}

function emissiveFromStatus(status?: FleetBeaconStatus | string | null, reached?: boolean): number {
  if (reached === false || status === "pending") return 0.28;
  if (status === "queued" || status === "idle") return 0.22;
  if (status === "active" || status === "stalled") return 0.7;
  if (status === "blocked") return 0.85;
  // done / reached / healthy — was MeshStandard emissiveIntensity 0.85 (LED)
  return 0.72;
}

/**
 * Watercolor status beacon for queue road + landing hops.
 * Replaces `new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.85 })`.
 */
export function createFleetBeacon(
  kit: PainterlyKit,
  opts: FleetBeaconOptions = {},
): PainterlyFleetBeaconBundle {
  const status = opts.status ?? (opts.reached === false ? "pending" : opts.reached === true ? "reached" : "done");
  const idle = opts.idle ?? idleFromStatus(status, opts.reached);
  const health = opts.health ?? healthFromStatus(status);
  const emissive = sanitizePainterEmissive(
    opts.emissiveIntensity ?? emissiveFromStatus(status, opts.reached),
    0.72,
  );
  // Dense string-lights: quieter glow / higher matte so overlap doesn't LED-wash
  const matte = opts.matte ?? (idle ? 0.95 : Math.max(PAINTER_MATTE_DEFAULT, 0.88));
  const star = createPainterlyBotStar(kit, {
    color: opts.color ?? 0x3dd68c,
    idle,
    health,
    emissiveIntensity: emissive,
    matte,
    halo: opts.halo ?? (idle ? 0.14 : 0.48),
    grain: opts.grain,
    stroke: opts.stroke,
    forceFallback: opts.forceFallback,
  });
  const radius = sanitizeFleetBeaconRadius(opts.radius ?? FLEET_BEACON_RADIUS_DEFAULT);

  const setStatus = (next: FleetBeaconStatus | string, color?: THREE.ColorRepresentation) => {
    const h = healthFromStatus(next);
    const idl = idleFromStatus(next);
    const em = emissiveFromStatus(next);
    const col = color ?? opts.color ?? 0x3dd68c;
    // Pigment path (c26) — never raw neon onto glow
    star.setColor(col, em);
    star.setMatte(idl ? 0.95 : Math.max(PAINTER_MATTE_DEFAULT, 0.88));
    star.setHalo(idl ? 0.14 : 0.48);
    star.setGrain(
      h === "blocked" ? 0.42 : h === "stalled" ? 0.3 : h === "idle" ? 0.12 : 0.2,
    );
    // Ensure status color went through pigment (uColor soft-capped — never raw LED)
    const pig = painterPigmentFromStatusColor(col);
    const u = star.meshMaterial.uniforms["uColor"]?.value as THREE.Color | undefined;
    if (u && pig.ok) {
      // setColor already applied pigment; assert soft-cap holds for dense string-lights
      const maxC = Math.max(u.r, u.g, u.b);
      if (maxC > 0.72) u.multiplyScalar(0.72 / maxC);
    }
  };

  const setReached = (reached: boolean, color?: THREE.ColorRepresentation) => {
    setStatus(reached ? "reached" : "pending", color);
  };

  return {
    ...star,
    setStatus,
    setReached,
    radius,
  };
}

/** Shared sphere geo helper (caller owns dispose). */
export function createFleetBeaconGeometry(radius = FLEET_BEACON_RADIUS_DEFAULT): THREE.SphereGeometry {
  const r = sanitizeFleetBeaconRadius(radius);
  return new THREE.SphereGeometry(r, 20, 20);
}
