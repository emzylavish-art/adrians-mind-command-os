/**
 * Cheap stable signature for universe-scene's 5s rebuild gate.
 * Must cover every field rebuildCards / rebuildPages / rebuildAll consume,
 * or cards and Notion stars go stale under an unchanged-data skip (Gap #67).
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

/** Mirrors rebuildCards(status) inputs exactly (universe-scene). */
export type SceneSyncCardInputs = {
  weather?: {
    tone?: string | null;
    label?: string | null;
    summary?: string | null;
  } | null;
  orchestrator?: {
    owner?: string | null;
    status?: string | null;
    branch?: string | null;
  } | null;
  gapDispatcher?: {
    source?: string | null;
    items?: Array<{ rank?: number | null; feature?: string | null; status?: string | null } | null> | null;
  } | null;
  spend?: {
    available?: boolean | null;
    reason?: string | null;
  } | null;
  conductor?: {
    source?: string | null;
    nudges?: Array<string | null> | null;
  } | null;
  commits?: Array<{ sha?: string | null; subject?: string | null } | null> | null;
};

/** Mirrors rebuildPages(status) inputs (notionGraph.pages id+title; child edges). */
export type SceneSyncPageInputs = {
  notionGraph?: {
    pages?: Array<{ id?: string | null; title?: string | null } | null> | null;
    edges?: Array<{ from?: string | null; to?: string | null; kind?: string | null } | null> | null;
  } | null;
};

export type SceneSyncInput = SceneSyncCardInputs &
  SceneSyncPageInputs & {
    bots?: SceneSyncBot[] | null;
    constellationEdges?: SceneSyncEdge[] | null;
    skyFeed?: SceneSyncFeed | null;
    fleetPlan?: {
      landings?: Array<{ lane?: string | null; tipSha?: string | null } | null> | null;
      queueHead?: { index?: number | null; title?: string | null } | null;
    } | null;
  };

/** Digest of fields rebuildCards reads — keep in lockstep with universe-scene rebuildCards. */
export function dashboardRebuildCardsDigest(status: SceneSyncCardInputs | null | undefined): string {
  if (!status) return "";
  const w = status.weather;
  const o = status.orchestrator;
  const g = status.gapDispatcher;
  const s = status.spend;
  const c = status.conductor;
  const hasCards =
    !!w ||
    !!o ||
    !!g ||
    !!s ||
    !!c ||
    (Array.isArray(status.commits) && status.commits.length > 0);
  if (!hasCards) return "";
  const parts: string[] = [];
  parts.push(`w:${w?.tone ?? ""}:${w?.label ?? ""}:${(w?.summary ?? "").slice(0, 80)}`);
  parts.push(`o:${o?.owner ?? ""}:${o?.status ?? ""}:${o?.branch ?? ""}`);
  const items = Array.isArray(g?.items) ? g!.items! : [];
  const gapBits = items.slice(0, 4).map((it) => `${it?.rank ?? "·"} ${it?.feature ?? ""}`).join(" · ");
  parts.push(`g:${gapBits || `source:${g?.source ?? ""}`}:${g?.source ?? ""}`);
  if (s?.available) parts.push("s:live");
  else parts.push(`s:${s?.reason ?? ""}`);
  const nudges = Array.isArray(c?.nudges) ? c!.nudges!.slice(0, 3).map((n) => n ?? "").join(" · ") : "";
  parts.push(`n:${nudges || `source:${c?.source ?? ""}`}:${c?.source ?? ""}`);
  const commits = Array.isArray(status.commits) ? status.commits : [];
  for (const cm of commits.slice(0, 3)) {
    if (!cm) continue;
    parts.push(`cs:${cm.sha ?? ""}:${(cm.subject ?? "").slice(0, 60)}`);
  }
  return parts.join("|");
}

/** Digest of fields rebuildPages reads — pages id+title (+ child edge endpoints). */
export function dashboardRebuildPagesDigest(status: SceneSyncPageInputs | null | undefined): string {
  if (!status?.notionGraph) return "";
  const parts: string[] = [];
  const pages = Array.isArray(status.notionGraph.pages) ? status.notionGraph.pages : [];
  for (const p of pages) {
    if (!p) continue;
    parts.push(`p:${p.id ?? ""}:${(p.title ?? "").slice(0, 48)}`);
  }
  const edges = Array.isArray(status.notionGraph.edges) ? status.notionGraph.edges : [];
  let drawn = 0;
  for (const e of edges) {
    if (!e || e.kind !== "child") continue;
    parts.push(`pe:${e.from ?? ""}>${e.to ?? ""}`);
    if (++drawn > 80) break;
  }
  return parts.join("|");
}

/** Deterministic signature for 5s sync skip (Gap #67: cards + pages included). */
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
  // Full commit list sha (bots/edges path) + subjects via cards digest
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

  const cards = dashboardRebuildCardsDigest(data);
  if (cards) parts.push(cards);
  const pages = dashboardRebuildPagesDigest(data);
  if (pages) parts.push(pages);

  return parts.join("|") || "empty";
}
