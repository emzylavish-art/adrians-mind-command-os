/** Server-safe Notion graph helpers (may touch node:fs). Client code must import notion-graph-core. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseNotionSnapshot,
  type NotionGraph,
} from "./notion-graph-core.ts";

export * from "./notion-graph-core.ts";

export function loadNotionSnapshotFile(
  candidates: string[] = [
    join(process.cwd(), "scripts/dashboard/notion-snapshot.json"),
    join(process.cwd(), "src/lib/mind/dashboard/notion-snapshot.json"),
    "/workspace/mind-command-os-dashboard/scripts/dashboard/notion-snapshot.json",
  ],
): NotionGraph {
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const parsed = parseNotionSnapshot(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed || !parsed.pages.length) continue;
      return {
        available: true,
        mode: "snapshot",
        generatedAt: parsed.generatedAt,
        pages: parsed.pages,
        edges: parsed.edges.filter((e) => !e.to.startsWith("bot:") && !e.from.startsWith("bot:")),
        botPageMap: parsed.botPageMap,
        stats: parsed.stats,
        reason: parsed.note,
      };
    } catch {
      // try next
    }
  }
  return {
    available: false,
    mode: "unavailable",
    reason: "No Notion snapshot file found and NOTION_TOKEN unset.",
    generatedAt: null,
    pages: [],
    edges: [],
    botPageMap: {},
    stats: { pages: 0, edges: 0, botsMapped: 0 },
  };
}
