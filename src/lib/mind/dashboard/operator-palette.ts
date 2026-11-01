/**
 * Queue #8 — Operator console (pure).
 * Cmd/Ctrl-K palette targets + layer prefs. No shell, no lock writes, no paid APIs.
 * Hacker: sanitize XSS in names, cap result lists, ignore when typing in inputs.
 */
import { sanitizeLabelText } from "./health.ts";
import type { BotNode, Health, NotionStopPoint } from "./types.ts";
import type { NotionSnapPage } from "./notion-graph-core.ts";
import type { CityBuilding } from "./city-layout.ts";

export const OPERATOR_STORAGE_KEY = "dash3d-operator-prefs-v1";
export const MAX_PALETTE_RESULTS = 40;
export const MAX_QUERY = 80;

export type OperatorTargetKind = "bot" | "building" | "notion";

export type OperatorTarget = {
  id: string;
  kind: OperatorTargetKind;
  /** Sanitized display label (never raw HTML). */
  label: string;
  sub: string;
  health?: Health;
  botId?: string;
  buildingId?: string;
  pageId?: string;
};

export type OperatorLayers = {
  feed: boolean;
  charts: boolean;
  sound: boolean; // true = sound allowed (unmuted preference for unmute); UI still respects health-sound mute
  labels: boolean;
  time: boolean;
};

export type OperatorPrefs = {
  layers: OperatorLayers;
  healthFilter: Health | "all";
  lastNodeId: string | null;
  lastNodeKind: OperatorTargetKind | null;
};

export const DEFAULT_LAYERS: OperatorLayers = {
  feed: true,
  charts: true,
  sound: false, // quiet by default — aligns with sound muted default
  labels: true,
  time: true,
};

export const DEFAULT_PREFS: OperatorPrefs = {
  layers: { ...DEFAULT_LAYERS },
  healthFilter: "all",
  lastNodeId: null,
  lastNodeKind: null,
};

/** Strip tags/control chars for palette rows (XSS harden). */
export function sanitizePaletteText(raw: string, max = 96): string {
  return sanitizeLabelText(
    String(raw ?? "")
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/javascript:/gi, "")
      .replace(/on\w+=/gi, ""),
    max,
  );
}

export function shouldIgnoreOperatorHotkey(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (sel: string) => unknown;
  };
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  try {
    if (typeof el.closest === "function") {
      if (el.closest("[contenteditable='true']")) return true;
      if (el.closest("input, textarea, select, [role='textbox']")) return true;
    }
  } catch {
    /* non-DOM stub */
  }
  return false;
}

export function buildOperatorTargets(input: {
  bots?: readonly BotNode[] | null;
  buildings?: readonly CityBuilding[] | null;
  pages?: readonly NotionSnapPage[] | null;
  healthFilter?: Health | "all";
}): OperatorTarget[] {
  const filter = input.healthFilter ?? "all";
  const out: OperatorTarget[] = [];

  for (const b of input.bots ?? []) {
    if (!b?.id) continue;
    if (filter !== "all" && b.health !== filter) continue;
    out.push({
      id: `bot:${b.id}`,
      kind: "bot",
      label: sanitizePaletteText(b.name || b.id),
      sub: sanitizePaletteText(
        `${b.health}${b.branch ? ` · ${b.branch}` : ""}${b.lock?.file ? ` · ${b.lock.file}` : ""}`,
        120,
      ),
      health: b.health,
      botId: b.id,
    });
  }

  for (const b of input.buildings ?? []) {
    if (!b?.id) continue;
    if (filter !== "all" && b.health !== filter) continue;
    out.push({
      id: `building:${b.id}`,
      kind: "building",
      label: sanitizePaletteText(b.name || b.id),
      sub: sanitizePaletteText(`${b.kind} · ${b.health} · ${b.floors} floors`, 120),
      health: b.health,
      buildingId: b.id,
    });
  }

  for (const p of input.pages ?? []) {
    if (!p?.id) continue;
    out.push({
      id: `notion:${p.id}`,
      kind: "notion",
      label: sanitizePaletteText(p.title || p.id),
      sub: sanitizePaletteText(`${p.kind || "page"}${p.lastEdited ? ` · ${p.lastEdited}` : ""}`, 120),
      pageId: p.id,
    });
  }

  return out;
}

export function filterOperatorTargets(
  targets: readonly OperatorTarget[],
  query: string,
  max = MAX_PALETTE_RESULTS,
): OperatorTarget[] {
  const q = sanitizePaletteText(query, MAX_QUERY).toLowerCase();
  const cappedMax = Math.min(MAX_PALETTE_RESULTS, Math.max(1, Math.floor(max)));
  let list = targets.slice();
  if (q) {
    list = list.filter((t) => {
      const hay = `${t.label} ${t.sub} ${t.botId ?? ""} ${t.buildingId ?? ""} ${t.pageId ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }
  // stable-ish: bots, buildings, notion then label
  const rank = (k: OperatorTargetKind) => (k === "bot" ? 0 : k === "building" ? 1 : 2);
  list.sort((a, b) => rank(a.kind) - rank(b.kind) || a.label.localeCompare(b.label));
  return list.slice(0, cappedMax);
}

/** Plain-text lock/branch summary for clipboard (no HTML). */
export function formatBotClipboardSummary(bot: BotNode): string {
  const lines = [
    sanitizePaletteText(bot.name || bot.id, 120),
    `id: ${sanitizePaletteText(bot.id, 64)}`,
    `health: ${bot.health}`,
    `branch: ${sanitizePaletteText(bot.branch || "none", 120)}`,
    `lock: ${sanitizePaletteText(bot.lock?.file || "none", 120)}`,
    `status: ${sanitizePaletteText(bot.lock?.status || "none", 120)}`,
    `claimed_at: ${sanitizePaletteText(bot.lock?.claimed_at || "none", 64)}`,
    `released_at: ${sanitizePaletteText(bot.lock?.released_at || "none", 64)}`,
    `heartbeat_at: ${sanitizePaletteText(bot.lock?.raw?.heartbeat_at || bot.lock?.raw?.heartbeat || "none", 64)}`,
    `reason: ${sanitizePaletteText(bot.reason || "", 160)}`,
  ];
  return lines.join("\n");
}

export function readOperatorPrefs(storage: Pick<Storage, "getItem"> | null | undefined): OperatorPrefs {
  if (!storage) return { ...DEFAULT_PREFS, layers: { ...DEFAULT_LAYERS } };
  try {
    const raw = storage.getItem(OPERATOR_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS, layers: { ...DEFAULT_LAYERS } };
    const parsed = JSON.parse(raw) as Partial<OperatorPrefs>;
    const layers = { ...DEFAULT_LAYERS, ...(parsed.layers ?? {}) };
    const hf = parsed.healthFilter;
    const healthFilter: Health | "all" =
      hf === "all" || hf === "healthy" || hf === "stalled" || hf === "blocked" || hf === "idle" ? hf : "all";
    return {
      layers,
      healthFilter,
      lastNodeId: typeof parsed.lastNodeId === "string" ? parsed.lastNodeId.slice(0, 120) : null,
      lastNodeKind:
        parsed.lastNodeKind === "bot" || parsed.lastNodeKind === "building" || parsed.lastNodeKind === "notion"
          ? parsed.lastNodeKind
          : null,
    };
  } catch {
    return { ...DEFAULT_PREFS, layers: { ...DEFAULT_LAYERS } };
  }
}

export function writeOperatorPrefs(
  storage: Pick<Storage, "setItem"> | null | undefined,
  prefs: OperatorPrefs,
): void {
  if (!storage) return;
  try {
    storage.setItem(OPERATOR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

// silence unused NotionStopPoint if tree-shaken — keep import for queue #9 sibling types
export type { NotionStopPoint };
