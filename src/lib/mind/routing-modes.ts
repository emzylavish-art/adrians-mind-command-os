import type { LogicRouteId } from "./logic-routes.ts";
import { isLogicRouteId, LOGIC_ROUTE_LABEL } from "./logic-routes.ts";

/** A single model. B two models, outputs kept. C panel, outputs kept. D comparison, no merge. */
export type RoutingMode = "A" | "B" | "C" | "D";

export const ROUTING_MODE_KEY = "amcos.routingMode.v1";
export const ROUTING_PANEL_KEY = "amcos.routingPanel.v1";

export const ROUTING_MODE_LABEL: Record<RoutingMode, string> = {
  A: "Single",
  B: "Two models",
  C: "Panel",
  D: "Compare",
};

export type RouteSeat = {
  id: LogicRouteId;
  label: string;
  ready: boolean;
  reason: string;
};

export type RoutingCall = {
  route: LogicRouteId | null;
  label: string;
  role: string;
};

export type RoutingPlan =
  | { ok: true; mode: RoutingMode; calls: RoutingCall[]; merge: false; note: string }
  | { ok: false; mode: RoutingMode; reason: string };

export function isRoutingMode(value: unknown): value is RoutingMode {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

export function readRoutingMode(storage: Pick<Storage, "getItem"> | null | undefined): RoutingMode {
  try {
    const raw = storage?.getItem(ROUTING_MODE_KEY);
    if (isRoutingMode(raw)) return raw;
  } catch {
    /* private mode */
  }
  return "A";
}

export function writeRoutingMode(storage: Pick<Storage, "setItem"> | null | undefined, mode: RoutingMode): void {
  try {
    storage?.setItem(ROUTING_MODE_KEY, mode);
  } catch {
    /* private mode */
  }
}

export function readRoutingPanel(storage: Pick<Storage, "getItem"> | null | undefined): LogicRouteId[] {
  try {
    const raw = storage?.getItem(ROUTING_PANEL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLogicRouteId);
  } catch {
    return [];
  }
}

export function writeRoutingPanel(storage: Pick<Storage, "setItem"> | null | undefined, panel: LogicRouteId[]): void {
  try {
    storage?.setItem(ROUTING_PANEL_KEY, JSON.stringify(panel));
  } catch {
    /* private mode */
  }
}

function seatById(seats: RouteSeat[], id: LogicRouteId): RouteSeat | undefined {
  return seats.find((seat) => seat.id === id);
}

function callFor(seat: RouteSeat, role: string): RoutingCall {
  return { route: seat.id, label: seat.label, role };
}

/**
 * Plans real calls only. Merge stays false: individual outputs are never replaced
 * by a synthesized answer. Unready routes block the send. Nothing is invented.
 */
export function planRouting(input: {
  mode: RoutingMode;
  primary: LogicRouteId | null;
  seats: RouteSeat[];
  panel: LogicRouteId[];
}): RoutingPlan {
  const { mode, primary, seats, panel } = input;
  if (mode === "A") {
    if (!primary) {
      return {
        ok: true,
        mode,
        calls: [{ route: null, label: "Selected model", role: "single" }],
        merge: false,
        note: "Single model. No second model is called.",
      };
    }
    const seat = seatById(seats, primary);
    if (!seat?.ready) {
      return { ok: false, mode, reason: seat?.reason || `${LOGIC_ROUTE_LABEL[primary]} is not ready. Nothing was sent.` };
    }
    return {
      ok: true,
      mode,
      calls: [callFor(seat, "single")],
      merge: false,
      note: `Single model: ${seat.label}. No second model is called.`,
    };
  }

  const unique = [...new Set(panel)];
  const needed = mode === "B" ? 2 : 2;
  if (unique.length < needed) {
    return {
      ok: false,
      mode,
      reason: mode === "B"
        ? "Two models needs two ready routes selected. Nothing was sent."
        : mode === "C"
          ? "Panel needs at least two ready routes selected. Nothing was sent."
          : "Compare needs at least two ready routes selected. Nothing was sent.",
    };
  }
  if (mode === "B" && unique.length !== 2) {
    return { ok: false, mode, reason: "Two models uses exactly two routes. Nothing was sent." };
  }
  const chosen = unique.map((id) => seatById(seats, id));
  const missing = chosen.filter((seat) => !seat?.ready);
  if (missing.length > 0 || chosen.some((seat) => !seat)) {
    const names = unique.filter((id) => !seatById(seats, id)?.ready).map((id) => LOGIC_ROUTE_LABEL[id]);
    return {
      ok: false,
      mode,
      reason: `${names.join(", ") || "A selected route"} is not ready. Nothing was sent.`,
    };
  }
  const ready = chosen.filter((seat): seat is RouteSeat => Boolean(seat?.ready));
  const role = mode === "B" ? "comparison" : mode === "C" ? "specialist" : "independent";
  const note = mode === "C"
    ? "Each specialist answer is kept. No merge call is made."
    : mode === "D"
      ? "Each answer is kept separately. No merge is made."
      : "Both answers are kept. No merge is made.";
  return { ok: true, mode, calls: ready.map((seat) => callFor(seat, role)), merge: false, note };
}

export type ResponseRating = {
  messageId: string;
  score: 1 | 2 | 3 | 4 | 5;
  model: string | null;
  mode: RoutingMode | null;
  provider?: string;
  at: string;
};

const RATING_KEY = "amcos.responseRatings.v1";

export function isRatingScore(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function readRatings(storage: Pick<Storage, "getItem"> | null | undefined, owner = "device:guest"): ResponseRating[] {
  try {
    const raw = storage?.getItem(RATING_KEY + "." + owner);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Partial<ResponseRating>;
      if (typeof row.messageId !== "string" || !isRatingScore(row.score) || (row.mode !== null && !isRoutingMode(row.mode)) || typeof row.at !== "string") return [];
      return [{ messageId: row.messageId, score: row.score, ...(typeof row.provider === "string" ? { provider: row.provider } : {}), model: typeof row.model === "string" ? row.model : null, mode: row.mode, at: row.at }];
    });
  } catch {
    return [];
  }
}

export function saveRating(storage: Pick<Storage, "getItem" | "setItem"> | null | undefined, rating: ResponseRating, owner = "device:guest"): ResponseRating[] {
  const next = [rating, ...readRatings(storage, owner).filter((item) => item.messageId !== rating.messageId)].slice(0, 200);
  if (!storage) throw new Error("Rating storage unavailable");
  storage.setItem(RATING_KEY + "." + owner, JSON.stringify(next));
  return next;
}
