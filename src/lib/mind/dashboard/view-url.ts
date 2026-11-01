/**
 * Queue #39 / Gap#16 — shareable ?focus=&level= view state.
 */
export type ViewLevel = "universe" | "city" | "interior";

export type ViewUrlState = {
  focus: string | null;
  level: ViewLevel;
};

const LEVELS = new Set<ViewLevel>(["universe", "city", "interior"]);

export function parseViewLevel(raw: unknown): ViewLevel {
  const s = String(raw ?? "").trim().toLowerCase();
  return LEVELS.has(s as ViewLevel) ? (s as ViewLevel) : "universe";
}

export function sanitizeFocusId(raw: unknown, allowedIds?: ReadonlySet<string> | null): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim().slice(0, 80);
  if (!id || /[^a-zA-Z0-9._-]/i.test(id)) return null;
  if (allowedIds && !allowedIds.has(id)) return null;
  return id;
}

export function parseViewUrlSearch(search: string, allowedIds?: ReadonlySet<string> | null): ViewUrlState {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    focus: sanitizeFocusId(q.get("focus"), allowedIds),
    level: parseViewLevel(q.get("level")),
  };
}

export function buildViewUrlSearch(state: ViewUrlState, base = ""): string {
  const q = new URLSearchParams(base.startsWith("?") ? base.slice(1) : base);
  if (state.focus) q.set("focus", state.focus);
  else q.delete("focus");
  if (state.level && state.level !== "universe") q.set("level", state.level);
  else q.delete("level");
  const s = q.toString();
  return s ? `?${s}` : "";
}
