/**
 * Projects → painted city layout. Pure, deterministic, real-data only:
 * floors come from real task counts; lit floors only when progress is known.
 */
import type { Health } from "./types.ts";
import type { ProjectBuilding, ProjectsDashboard } from "./projects.ts";
import { nightShiftFloors as computeNightShift } from "./night-shift.ts";

export type CityBuilding = {
  id: string;
  name: string;
  kind: "project" | "bot";
  health: Health;
  x: number;
  z: number;
  width: number;
  depth: number;
  floors: number;
  floorHeight: number;
  height: number;
  /** floors lit by real progress; 0 when unknown */
  litFloors: number;
  progressKnown: boolean;
  progress: number;
  /** real task states (capped) for interior task lanterns */
  taskStates: Array<"open" | "done">;
  /** floors with night-shift glow from real lastActivityAt within 30m */
  nightShiftFloors: number[];
  nightShiftActive: boolean;
  nightShiftSteady: boolean;
};


export type CityLayout = {
  buildings: CityBuilding[];
  radius: number;
  available: boolean;
  reason?: string;
};

export const MAX_BUILDINGS = 48;
export const MAX_FLOORS = 12;
const SPACING = 3.4;
const FLOOR_H = 0.42;

function finite01(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function floorsFor(p: Pick<ProjectBuilding, "openTasks" | "doneTasks" | "recentRuns" | "kind">): number {
  const tasks = count(p.openTasks) + count(p.doneTasks);
  const runs = Array.isArray(p.recentRuns) ? p.recentRuns.length : 0;
  const raw = p.kind === "project" ? tasks : tasks + runs;
  return Math.max(1, Math.min(MAX_FLOORS, raw));
}

const HEALTHS: Health[] = ["healthy", "stalled", "blocked", "idle"];

export function buildCityLayout(
  projects: ProjectsDashboard | null | undefined,
  opts?: { nowMs?: number; reducedMotion?: boolean },
): CityLayout {
  if (!projects || !Array.isArray(projects.projects)) {
    return { buildings: [], radius: 6, available: false, reason: "Projects data unavailable." };
  }
  const nowMs = Number.isFinite(opts?.nowMs) ? (opts!.nowMs as number) : Date.now();
  const reducedMotion = Boolean(opts?.reducedMotion);
  const seen = new Set<string>();
  const list = projects.projects
    .filter((p) => p && typeof p.id === "string" && p.id && !seen.has(p.id) && (seen.add(p.id), true))
    .slice(0, MAX_BUILDINGS);
  // projects first (center of the city), then bots alphabetically
  list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "project" ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  const n = list.length;
  if (!n) {
    return { buildings: [], radius: 6, available: false, reason: projects.reason ?? "No projects or bots found." };
  }
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const buildings: CityBuilding[] = list.map((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const floors = floorsFor(p);
    const progressKnown = Boolean(p.progressKnown);
    const progress = progressKnown ? finite01(p.progress) : 0;
    const big = p.kind === "project";
    return {
      id: p.id,
      name: String(p.name ?? p.id),
      kind: p.kind === "bot" ? "bot" : "project",
      health: HEALTHS.includes(p.health) ? p.health : "idle",
      x: (col - (cols - 1) / 2) * SPACING,
      z: (row - (rows - 1) / 2) * SPACING,
      width: big ? 2.1 : 1.5,
      depth: big ? 2.1 : 1.5,
      floors,
      floorHeight: FLOOR_H,
      height: floors * FLOOR_H + 0.3,
      litFloors: progressKnown ? Math.round(progress * floors) : 0,
      progressKnown,
      progress,
      taskStates: (Array.isArray(p.tasks) ? p.tasks : [])
        .slice(0, 24)
        .map((t) => (t && t.status === "done" ? "done" : "open")),
      ...(() => {
        const ns = computeNightShift({
          floors,
          lastActivityAt: p.lastActivityAt ?? null,
          nowMs,
          reducedMotion,
        });
        return {
          nightShiftFloors: ns.floors,
          nightShiftActive: ns.active,
          nightShiftSteady: ns.steady,
        };
      })(),
    };
  });
  const radius = (Math.max(cols, rows) * SPACING) / 2;
  return { buildings, radius, available: true };
}
