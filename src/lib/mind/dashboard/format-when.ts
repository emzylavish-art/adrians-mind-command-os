/**
 * Gap #22 — unescape Markdown ISO timestamps and format relative WAT times.
 */
export function unescapeMarkdownIso(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\\:/g, ":")
    .replace(/\\_/g, "_")
    .trim();
}

/** Pull leading ISO-like stamp from mirror titles. */
export function extractIsoPrefix(raw: unknown): { iso: string | null; rest: string } {
  const s = unescapeMarkdownIso(raw);
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*(.*)$/);
  if (!m) return { iso: null, rest: s };
  return { iso: m[1]!, rest: (m[2] || "").trim() };
}

export function formatRelativeWhen(iso: string, nowMs = Date.now()): { label: string; title: string } {
  const ms = Date.parse(iso);
  const title = Number.isFinite(ms)
    ? `${new Date(ms).toLocaleString("en-GB", { timeZone: "Africa/Lagos", hour12: false })} WAT`
    : iso;
  if (!Number.isFinite(ms)) return { label: iso.slice(0, 16), title };
  const delta = Math.max(0, nowMs - ms);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return { label: "just now", title };
  if (mins < 60) return { label: `${mins} min ago`, title };
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return { label: `${hrs} h ago`, title };
  const days = Math.floor(hrs / 24);
  return { label: `${days} d ago`, title };
}
