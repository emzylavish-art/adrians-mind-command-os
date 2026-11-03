export type QueueItemStatus = "done" | "active" | "queued" | "unknown";

export type QueueItem = {
  index: number;
  title: string;
  status: QueueItemStatus;
  detail: string;
  sha?: string;
};

/** Hacker c20: refuse to scan unbounded markdown / emit unbounded rows. */
export const MAX_QUEUE_MD_BYTES = 512_000;
export const MAX_QUEUE_ROWS = 200;

function splitRowCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const inner = t.endsWith("|") ? t.slice(1, -1) : t.slice(1);
  return inner.split("|").map((c) => c.trim());
}

/**
 * Parse forever-contract table rows from DASHBOARD_QUEUE.md.
 * Cell-based (c20): `| idx | **Title** [— detail] | status | notes |`.
 * The old single regex silently dropped rows whose title had no " — detail"
 * or whose bold title itself contained an em dash, so queued items vanished
 * and the forever guard / sky road showed a thinner (or empty) queue than reality.
 */
export function parseDashboardQueueMarkdown(md: string): QueueItem[] {
  const items: QueueItem[] = [];
  const seen = new Set<number>();
  const text = typeof md === "string" ? md.slice(0, MAX_QUEUE_MD_BYTES) : "";
  for (const line of text.split(/\r?\n/)) {
    if (items.length >= MAX_QUEUE_ROWS) break;
    const cells = splitRowCells(line);
    if (!cells || cells.length < 3) continue;
    if (!/^\d{1,6}$/.test(cells[0]!)) continue;
    const index = Number(cells[0]);
    if (!Number.isSafeInteger(index) || seen.has(index)) continue;
    const upgrade = cells[1]!;
    const bold = upgrade.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/);
    const title = (bold ? bold[1]! : upgrade).trim();
    if (!title) continue;
    const detail = (bold ? bold[2]! : "").trim();
    const statusCell = cells[2]!.replace(/\*/g, "").trim();
    let status: QueueItemStatus = "unknown";
    if (/^done\b/i.test(statusCell)) status = "done";
    else if (/^active\b/i.test(statusCell)) status = "active";
    else if (/^queued\b/i.test(statusCell)) status = "queued";
    const shaMatch = statusCell.match(/@\s*([0-9a-f]{7,40})/i);
    const notes = cells.slice(3).filter(Boolean).join(" | ").trim();
    seen.add(index);
    items.push({
      index,
      title,
      status,
      detail: [detail, notes].filter(Boolean).join(" · "),
      sha: shaMatch?.[1],
    });
  }
  return items.sort((a, b) => a.index - b.index);
}

export function queueHead(items: QueueItem[]): QueueItem | null {
  return items.find((i) => i.status === "active") ?? items.find((i) => i.status === "queued") ?? null;
}

/** Fibonacci-ish sky road positions for queue waypoints */
export function queueWaypointPositions(
  count: number,
  origin: [number, number, number] = [-14, 8.8, -5],
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    out.push([origin[0] + i * 2.45, origin[1] + Math.sin(i * 0.55) * 0.65, origin[2] + (i % 2) * 0.8]);
  }
  return out;
}
