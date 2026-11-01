/**
 * Parse lane INTEGRATION.md / queue notes that name a bot — real text only.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { QueueItem } from "./queue-parse.ts";
import { MAX_QUEUE_MD_BYTES, MAX_QUEUE_ROWS } from "./queue-parse.ts";

const LANE_DOC_CANDIDATES = [
  "src/components/mind/dashboard-3d/motion/INTEGRATION.md",
  "src/components/mind/dashboard-3d/postfx/README.md",
  "src/components/mind/dashboard-3d/particles/INTEGRATION.md",
  "src/components/mind/dashboard-3d/atmosphere/INTEGRATION.md",
  "src/components/mind/dashboard-3d/materials/INTEGRATION.md",
];

/** Extract markdown table rows OR "## " headings that look like queue lines. */
export function parseLaneQueueMarkdown(md: string, sourceLabel: string): QueueItem[] {
  const text = typeof md === "string" ? md.slice(0, MAX_QUEUE_MD_BYTES) : "";
  const items: QueueItem[] = [];
  let synthetic = -1000;
  for (const line of text.split(/\r?\n/)) {
    if (items.length >= MAX_QUEUE_ROWS) break;
    const t = line.trim();
    // Table row with numeric index (same shape as DASHBOARD_QUEUE)
    if (t.startsWith("|")) {
      const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.length >= 3 && /^\d{1,6}$/.test(cells[0]!)) {
        const index = Number(cells[0]);
        const upgrade = cells[1] ?? "";
        const bold = upgrade.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/);
        const title = (bold ? bold[1]! : upgrade).trim();
        if (!title) continue;
        items.push({
          index,
          title,
          status: /done/i.test(cells[2] ?? "") ? "done" : /queued|active/i.test(cells[2] ?? "") ? "queued" : "unknown",
          detail: [bold?.[2]?.trim() || "", cells.slice(3).join(" | "), `from ${sourceLabel}`].filter(Boolean).join(" · "),
        });
        continue;
      }
    }
    // Heading that mentions a wire/queue item: "## Foo (c21)" etc.
    const h = t.match(/^#{2,3}\s+(.+)$/);
    if (h) {
      const title = h[1]!.trim().slice(0, 160);
      if (title.length < 4) continue;
      items.push({
        index: synthetic--,
        title,
        status: "unknown",
        detail: `from ${sourceLabel}`,
      });
    }
  }
  return items;
}

export function loadLaneQueueDocs(
  cwd = process.cwd(),
  candidates: readonly string[] = LANE_DOC_CANDIDATES,
): QueueItem[] {
  const out: QueueItem[] = [];
  const seen = new Set<string>();
  for (const rel of candidates) {
    const path = join(cwd, rel);
    try {
      if (!existsSync(path)) continue;
      const st = statSync(path);
      if (!st.isFile() || st.size <= 0 || st.size > MAX_QUEUE_MD_BYTES) continue;
      const items = parseLaneQueueMarkdown(readFileSync(path, "utf8"), rel);
      for (const it of items) {
        const key = `${it.index}:${it.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
        if (out.length >= MAX_QUEUE_ROWS) return out;
      }
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}
