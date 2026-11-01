import type { DashboardBotId } from "./types.ts";
import { sanitizeNotionPlainText } from "./notion-plain.ts";
import { sanitizeNotionHref } from "./safe-notion-url.ts";

export type NotionSnapPage = {
  id: string;
  title: string;
  url: string;
  parentId: string | null;
  lastEdited: string | null;
  excerpt: string;
  kind: string;
};

export type NotionSnapEdge = { from: string; to: string; kind: string };

export type NotionSnapshot = {
  generatedAt: string;
  source: string;
  note?: string;
  pages: NotionSnapPage[];
  edges: NotionSnapEdge[];
  botPageMap: Partial<Record<DashboardBotId, string>>;
  stats: { pages: number; edges: number; botsMapped: number };
};

export type NotionGraph = {
  available: boolean;
  reason?: string;
  mode: "live" | "snapshot" | "unavailable";
  generatedAt: string | null;
  pages: NotionSnapPage[];
  edges: Array<{ from: string; to: string; kind: string }>;
  botPageMap: Partial<Record<DashboardBotId, string>>;
  stats: { pages: number; edges: number; botsMapped: number };
};

export function parseNotionSnapshot(raw: unknown): NotionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.pages) || !Array.isArray(o.edges)) return null;
  const pages: NotionSnapPage[] = [];
  for (const p of o.pages) {
    if (!p || typeof p !== "object") continue;
    const page = p as Record<string, unknown>;
    if (typeof page.id !== "string" || typeof page.title !== "string") continue;
    pages.push({
      id: page.id,
      title: sanitizeNotionPlainText(page.title, 160),
      url: sanitizeNotionHref(typeof page.url === "string" ? page.url : null, page.id) ??
        `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      parentId: typeof page.parentId === "string" ? page.parentId : null,
      lastEdited: typeof page.lastEdited === "string" ? page.lastEdited : null,
      excerpt: typeof page.excerpt === "string" ? sanitizeNotionPlainText(page.excerpt, 280) : "",
      kind: typeof page.kind === "string" ? page.kind : "page",
    });
  }
  const edges: NotionSnapEdge[] = [];
  for (const e of o.edges) {
    if (!e || typeof e !== "object") continue;
    const edge = e as Record<string, unknown>;
    if (typeof edge.from !== "string" || typeof edge.to !== "string") continue;
    edges.push({ from: edge.from, to: edge.to, kind: typeof edge.kind === "string" ? edge.kind : "link" });
  }
  const botPageMap = (o.botPageMap && typeof o.botPageMap === "object" ? o.botPageMap : {}) as Partial<
    Record<DashboardBotId, string>
  >;
  return {
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : "",
    source: typeof o.source === "string" ? o.source : "unknown",
    note: typeof o.note === "string" ? o.note : undefined,
    pages,
    edges,
    botPageMap,
    stats: {
      pages: pages.length,
      edges: edges.length,
      botsMapped: Object.keys(botPageMap).length,
    },
  };
}

export function pageStarPositions(count: number, radius = 14): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push([Math.cos(theta) * r * radius, y * radius * 0.55 + 2, Math.sin(theta) * r * radius]);
  }
  return out;
}

export function pageForBot(graph: NotionGraph, botId: DashboardBotId): NotionSnapPage | null {
  const id = graph.botPageMap[botId];
  if (!id) return null;
  return graph.pages.find((p) => p.id === id) ?? null;
}
