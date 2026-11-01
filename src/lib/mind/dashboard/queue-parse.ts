export type QueueItemStatus = "done" | "active" | "queued" | "unknown";

export type QueueItem = {
  index: number;
  title: string;
  status: QueueItemStatus;
  detail: string;
  sha?: string;
};

/** Parse forever-contract table rows from DASHBOARD_QUEUE.md */
export function parseDashboardQueueMarkdown(md: string): QueueItem[] {
  const items: QueueItem[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(
      /^\|\s*(\d+)\s*\|\s*\*\*(.+?)\*\*\s*[—|-]\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/,
    );
    if (!m) continue;
    const index = Number(m[1]);
    const title = m[2]!.trim();
    const detail = `${m[3]}`.trim();
    const statusCell = m[4]!.trim();
    let status: QueueItemStatus = "unknown";
    if (/\bdone\b/i.test(statusCell)) status = "done";
    else if (/\bactive\b/i.test(statusCell)) status = "active";
    else if (/\bqueued\b/i.test(statusCell)) status = "queued";
    const shaMatch = statusCell.match(/@\s*([0-9a-f]{7,40})/i);
    items.push({
      index,
      title,
      status,
      detail: [detail, m[5]?.trim()].filter(Boolean).join(" · "),
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
  origin: [number, number, number] = [-12, 7.5, -8],
): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    out.push([origin[0] + i * 2.15, origin[1] + Math.sin(i * 0.55) * 0.65, origin[2] + (i % 2) * 0.8]);
  }
  return out;
}
