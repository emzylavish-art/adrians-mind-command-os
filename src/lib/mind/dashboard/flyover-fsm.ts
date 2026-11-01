/**
 * Flyover camera state machine: universe (high above all constellations) → city of project
 * buildings → building interior. Pure + deterministic so it can be unit-tested without WebGL.
 * The scene feeds the resulting pose into the existing camera rig (flyTo/stepRig).
 */
import type { CameraTarget } from "./camera-rig.ts";
import type { CityBuilding, CityLayout } from "./city-layout.ts";

export type FlyLevel = "universe" | "city" | "interior";
export type EntryPart = "door" | "window";

export type FlyState = {
  level: FlyLevel;
  buildingId: string | null;
  part: EntryPart | null;
  floor: number | null;
};

export type FlyEvent =
  | { type: "DIVE" }
  | { type: "ENTER"; buildingId: string; part?: EntryPart; floor?: number }
  | { type: "ZOOM_OUT" }
  | { type: "SKY" }
  /** wheel at a dolly clamp: inward at min, outward at max */
  | { type: "WHEEL_LIMIT"; direction: "in" | "out" };

/** City sits far below the universe, under a cloud layer. */
export const CITY_Y = -36;
export const CLOUD_Y = -18;

/** High above the universe: every constellation (x ±9, y -5..3, z ±7) fits a 55° fov. */
export const UNIVERSE_HIGH: CameraTarget = {
  level: "universe",
  position: [0, 22, 24],
  lookAt: [0, -1.5, 0],
  subjectKind: "none",
};

export const FLY_HOME: FlyState = { level: "universe", buildingId: null, part: null, floor: null };

export function reduceFlyover(
  state: FlyState,
  ev: FlyEvent,
  knownBuildings: ReadonlySet<string>,
): FlyState {
  switch (ev.type) {
    case "DIVE":
      return { level: "city", buildingId: null, part: null, floor: null };
    case "ENTER": {
      if (state.level === "universe") return state; // must dive through the clouds first
      if (typeof ev.buildingId !== "string" || !knownBuildings.has(ev.buildingId)) return state;
      const floor =
        ev.part === "window" && Number.isFinite(ev.floor) ? Math.max(0, Math.min(127, Math.floor(ev.floor!))) : null;
      return { level: "interior", buildingId: ev.buildingId, part: ev.part === "window" ? "window" : "door", floor };
    }
    case "ZOOM_OUT":
      if (state.level === "interior") return { level: "city", buildingId: null, part: null, floor: null };
      return { ...FLY_HOME };
    case "SKY":
      return { ...FLY_HOME };
    case "WHEEL_LIMIT":
      if (ev.direction === "in" && state.level === "universe") return reduceFlyover(state, { type: "DIVE" }, knownBuildings);
      if (ev.direction === "out" && state.level !== "universe") return reduceFlyover(state, { type: "ZOOM_OUT" }, knownBuildings);
      return state;
    default:
      return state;
  }
}

/** If the building disappears from data (lock deleted / project renamed), fall back to city. */
export function reconcileFlyover(state: FlyState, knownBuildings: ReadonlySet<string>): FlyState {
  if (state.level === "interior" && (!state.buildingId || !knownBuildings.has(state.buildingId))) {
    return { level: "city", buildingId: null, part: null, floor: null };
  }
  return state;
}

export function cityOverviewTarget(layout: CityLayout): CameraTarget {
  const r = Math.max(6, layout.radius);
  return {
    level: "city",
    lookAt: [0, CITY_Y + 1, 0],
    position: [0, CITY_Y + r * 1.15 + 4, r * 1.35 + 6],
    subjectKind: "none",
  };
}

export function interiorTarget(b: CityBuilding, floor: number | null): CameraTarget {
  const f = floor == null ? 0 : Math.min(b.floors - 1, Math.max(0, floor));
  // Stand just inside the front wall at mid-floor and look up/back through the glass floor stack.
  const eyeY = CITY_Y + 0.15 + f * b.floorHeight + b.floorHeight * 0.5;
  const topY = CITY_Y + b.height;
  return {
    level: "interior",
    position: [b.x, eyeY, b.z + b.depth * 0.44],
    lookAt: [b.x, Math.min(topY, eyeY + Math.max(1.2, (topY - eyeY) * 0.75)), b.z - b.depth * 0.25],
    subjectId: b.id,
    subjectKind: b.kind === "bot" ? "bot" : "project",
  };
}

export function targetForState(state: FlyState, layout: CityLayout): CameraTarget {
  if (state.level === "city") return cityOverviewTarget(layout);
  if (state.level === "interior") {
    const b = layout.buildings.find((x) => x.id === state.buildingId);
    return b ? interiorTarget(b, state.floor) : cityOverviewTarget(layout);
  }
  return { ...UNIVERSE_HIGH };
}

/** Dolly clamps per level (min, max distance from lookAt). */
export function dollyLimits(level: FlyLevel): [number, number] {
  if (level === "city") return [5, 48];
  if (level === "interior") return [0.6, 3.5];
  return [4, 46];
}

/** Clamp a city pan so the camera can't wander off into the void. */
export function clampCityPan(x: number, z: number, layout: CityLayout): [number, number] {
  const lim = Math.max(4, layout.radius + 2);
  const cx = Number.isFinite(x) ? Math.max(-lim, Math.min(lim, x)) : 0;
  const cz = Number.isFinite(z) ? Math.max(-lim, Math.min(lim, z)) : 0;
  return [cx, cz];
}
