export type CameraLevel = "universe" | "city" | "interior";

export type CameraTarget = {
  level: CameraLevel;
  /** World-space look-at */
  lookAt: [number, number, number];
  /** Preferred camera position */
  position: [number, number, number];
  /** Optional subject id (bot, project, page) */
  subjectId?: string;
  /** Optional subject kind for detail panels */
  subjectKind?: "bot" | "project" | "notion" | "none";
};

export type CameraRigState = {
  level: CameraLevel;
  subjectId: string | null;
  subjectKind: "bot" | "project" | "notion" | "none";
  /** 0..1 eased progress of current transition */
  t: number;
  from: { position: [number, number, number]; lookAt: [number, number, number] };
  to: { position: [number, number, number]; lookAt: [number, number, number] };
};

export const UNIVERSE_HOME: CameraTarget = {
  level: "universe",
  lookAt: [0, 0, 0],
  position: [0, 11, 18],
  subjectKind: "none",
};

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function createRig(home: CameraTarget = UNIVERSE_HOME): CameraRigState {
  return {
    level: home.level,
    subjectId: home.subjectId ?? null,
    subjectKind: home.subjectKind ?? "none",
    t: 1,
    from: { position: [...home.position], lookAt: [...home.lookAt] },
    to: { position: [...home.position], lookAt: [...home.lookAt] },
  };
}

/** Begin a transition toward a target. */
export function flyTo(rig: CameraRigState, target: CameraTarget, currentPos: [number, number, number], currentLook: [number, number, number]): CameraRigState {
  return {
    level: target.level,
    subjectId: target.subjectId ?? null,
    subjectKind: target.subjectKind ?? "none",
    t: 0,
    from: { position: [...currentPos], lookAt: [...currentLook] },
    to: { position: [...target.position], lookAt: [...target.lookAt] },
  };
}

/** Advance transition; returns new rig + interpolated pose. */
export function stepRig(
  rig: CameraRigState,
  dtSec: number,
  durationSec = 1.15,
): { rig: CameraRigState; position: [number, number, number]; lookAt: [number, number, number] } {
  const nextT = Math.min(1, rig.t + dtSec / durationSec);
  const e = easeInOutCubic(nextT);
  const position = lerp3(rig.from.position, rig.to.position, e);
  const lookAt = lerp3(rig.from.lookAt, rig.to.lookAt, e);
  return { rig: { ...rig, t: nextT }, position, lookAt };
}

/** Zoom toward/away from lookAt while staying on the same level (damped). */
export function dollyPose(
  position: [number, number, number],
  lookAt: [number, number, number],
  delta: number,
  minDist = 3,
  maxDist = 42,
): [number, number, number] {
  const dx = position[0] - lookAt[0];
  const dy = position[1] - lookAt[1];
  const dz = position[2] - lookAt[2];
  const dist = Math.hypot(dx, dy, dz) || 1;
  const factor = Math.exp(-delta * 0.0015);
  let next = dist * factor;
  next = Math.min(maxDist, Math.max(minDist, next));
  const s = next / dist;
  return [lookAt[0] + dx * s, lookAt[1] + dy * s, lookAt[2] + dz * s];
}

/** Focus a bot star from universe (or city) level. */
export function focusBotTarget(
  botPos: [number, number, number],
  botId: string,
  level: CameraLevel = "universe",
): CameraTarget {
  const [x, y, z] = botPos;
  // Sit slightly above and out from the star
  const position: [number, number, number] = [x + 2.2, y + 1.6, z + 3.4];
  return {
    level,
    lookAt: [x, y, z],
    position,
    subjectId: botId,
    subjectKind: "bot",
  };
}

export function zoomOutTarget(level: CameraLevel): CameraTarget {
  if (level === "interior") {
    // step up to city overview
    return {
      level: "city",
      lookAt: [0, 0, 0],
      position: [8, 14, 16],
      subjectKind: "none",
    };
  }
  if (level === "city") {
    return { ...UNIVERSE_HOME };
  }
  return { ...UNIVERSE_HOME };
}
