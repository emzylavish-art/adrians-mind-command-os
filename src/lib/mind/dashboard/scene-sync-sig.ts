/**
 * Cheap stable signature for universe-scene's 5s rebuild gate.
 * Skip dispose/recreate thrash when bots/edges/feed/commits are unchanged.
 */

export type SceneSyncBot = {
  id: string;
  health: string;
  lock?: {
    status?: string | null;
    claimed_at?: string | null;
    released_at?: string | null;
    notes?: string | null;
    heartbeatAt?: string | null;
  } | null;
};

export type SceneSyncEdge = {
  from: string;
  to: string;
  health: string;
  kind: string;
};

export type SceneSyncFeed = {
  events?: Array<{ id?: string | null } | null> | null;
};

export type SceneSyncInput = {
  bots?: SceneSyncBot[] | null;
  constellationEdges?: SceneSyncEdge[] | null;
  skyFeed?: SceneSyncFeed | null;
  commits?: Array<{ sha?: string | null } | null> | null;
  fleetPlan?: {
    landings?: Array<{ lane?: string | null; tipSha?: string | null } | null> | null;
    queueHead?: { index?: number | null; title?: string | null } | null;
  } | null;
};

/** Deterministic, allocation-light signature for 5s sync skip. */
export function dashboardSceneSyncSignature(data: SceneSyncInput | null | undefined): string {
  if (!data) return "empty";
  const parts: string[] = [];
  const bots = Array.isArray(data.bots) ? data.bots : [];
  for (const b of bots) {
    if (!b || typeof b.id !== "string") continue;
    const lock = b.lock;
    parts.push(
      `b:${b.id}:${b.health ?? ""}:${lock?.status ?? ""}:${lock?.claimed_at ?? ""}:${lock?.released_at ?? ""}:${lock?.heartbeatAt ?? ""}:${(lock?.notes ?? "").slice(0, 48)}`,
    );
  }
  const edges = Array.isArray(data.constellationEdges) ? data.constellationEdges : [];
  for (const e of edges) {
    if (!e) continue;
    parts.push(`e:${e.from}>${e.to}:${e.kind}:${e.health}`);
  }
  const events = data.skyFeed?.events;
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (ev && typeof ev.id === "string" && ev.id) parts.push(`f:${ev.id}`);
    }
  }
  const commits = Array.isArray(data.commits) ? data.commits : [];
  for (const c of commits.slice(0, 24)) {
    if (c?.sha) parts.push(`c:${c.sha}`);
  }
  const landings = data.fleetPlan?.landings;
  if (Array.isArray(landings)) {
    for (const L of landings) {
      if (!L) continue;
      parts.push(`l:${L.lane ?? ""}:${L.tipSha ?? ""}`);
    }
  }
  const qh = data.fleetPlan?.queueHead;
  if (qh) parts.push(`q:${qh.index ?? ""}:${(qh.title ?? "").slice(0, 40)}`);
  return parts.join("|") || "empty";
}
