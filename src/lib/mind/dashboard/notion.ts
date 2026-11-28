import type { NotionStopPoint } from "./types.ts";
import type { NotionGraph, NotionSnapPage } from "./notion-graph-core.ts";

export const MIRROR_PAGE_ID = "40bb95f33e42814aacf8c3281b4f528d";

type NotionBlock = {
  id?: string;
  type?: string;
  paragraph?: { rich_text?: Array<{ plain_text?: string }> };
  heading_1?: { rich_text?: Array<{ plain_text?: string }> };
  heading_2?: { rich_text?: Array<{ plain_text?: string }> };
  heading_3?: { rich_text?: Array<{ plain_text?: string }> };
  bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
  numbered_list_item?: { rich_text?: Array<{ plain_text?: string }> };
  quote?: { rich_text?: Array<{ plain_text?: string }> };
  callout?: { rich_text?: Array<{ plain_text?: string }> };
};

function blockText(block: NotionBlock): string {
  const key = block.type;
  if (!key) return "";
  const payload = (block as Record<string, { rich_text?: Array<{ plain_text?: string }> }>)[key];
  const rich = payload?.rich_text ?? [];
  return rich.map((t) => t.plain_text ?? "").join("").trim();
}

export async function fetchNotionStopPoints(
  token: string | undefined,
  pageId = MIRROR_PAGE_ID,
  fetchImpl: typeof fetch = fetch,
): Promise<{ available: true; stopPoints: NotionStopPoint[] } | { available: false; reason: string }> {
  if (!token?.trim()) {
    return {
      available: false,
      reason: "NOTION_TOKEN is not set on the server. No Notion data was fetched.",
    };
  }

  try {
    const stopPoints: NotionStopPoint[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("start_cursor", cursor);
      const res = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          available: false,
          reason: `Notion API ${res.status}: ${body.slice(0, 240) || res.statusText}`,
        };
      }
      const json = (await res.json()) as {
        results?: NotionBlock[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      for (const block of json.results ?? []) {
        const text = blockText(block);
        if (!text) continue;
        if (/stop-point|stop point|\[[^\]]+Bot\]/i.test(text) || /—/.test(text)) {
          stopPoints.push({ text, blockId: block.id });
        }
      }
      cursor = json.has_more ? json.next_cursor ?? undefined : undefined;
      pages += 1;
    } while (cursor && pages < 5);

    // Prefer the most recent-looking stop points (last blocks)
    const recent = stopPoints.slice(-12).reverse();
    return { available: true, stopPoints: recent };
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function titleFromSearch(item: { properties?: Record<string, { title?: Array<{ plain_text?: string }> }> }): string {
  const properties = item.properties ?? {};
  for (const value of Object.values(properties)) {
    const text = value.title?.map((part) => part.plain_text ?? "").join("").trim();
    if (text) return text;
  }
  return "";
}

type GraphItem = {
  id?: string;
  object?: string;
  name?: string;
  description?: string;
  status?: string;
  agent_type?: string;
  instructions_page_id?: string;
  last_edited_time?: string;
  parent?: { page_id?: string };
  properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
};

type GraphCollection = { results: GraphItem[]; more: boolean; issue?: string };

async function graphCollection(
  token: string, resource: "pages" | "agents", limit: number, fetchImpl: typeof fetch,
): Promise<GraphCollection> {
  const pages = resource === "pages";
  const path = pages ? "search" : "agents/query";
  try {
    const response = await fetchImpl(`https://api.notion.com/v1/${path}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(9000),
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2026-03-11", "Content-Type": "application/json" },
      body: JSON.stringify(pages
        ? { page_size: limit, filter: { property: "object", value: "page" }, sort: { timestamp: "last_edited_time", direction: "descending" } }
        : { page_size: limit }),
    });
    if (!response.ok) {
      const issue = response.status === 403
        ? `This connection lacks access to ${resource}.`
        : response.status === 401 ? "Reconnect your Notion account."
        : `Notion ${resource} unavailable (HTTP ${response.status}).`;
      return { results: [], more: false, issue };
    }
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error("Invalid response");
    return { results: data.results.slice(0, limit), more: Boolean(data.has_more) };
  } catch {
    return { results: [], more: false, issue: `Notion ${resource} could not be loaded.` };
  }
}

export async function fetchNotionGraph(token: string, fetchImpl: typeof fetch = fetch): Promise<NotionGraph> {
  // The force graph budgets 48 workspace nodes per frame. Keep space for AI agents
  // even when an account has thousands of shared pages.
  const [pageBatch, agentBatch] = await Promise.all([
    graphCollection(token, "pages", 32, fetchImpl), graphCollection(token, "agents", 16, fetchImpl),
  ]);
  const pages: NotionSnapPage[] = [];
  const edges: NotionGraph["edges"] = [];
  const ids = new Set<string>();
  for (const item of pageBatch.results) {
    if (item?.object !== "page" || typeof item.id !== "string" || !item.id || ids.has(item.id)) continue;
    ids.add(item.id);
    pages.push({ id: item.id, title: titleFromSearch(item) || "Untitled page",
      url: `https://www.notion.so/${encodeURIComponent(item.id.replace(/-/g, ""))}`, parentId: item.parent?.page_id ?? null,
      lastEdited: item.last_edited_time ?? null, excerpt: "", kind: "page" });
  }
  for (const page of pages) {
    if (page.parentId && ids.has(page.parentId)) edges.push({ from: page.parentId, to: page.id, kind: "parent" });
  }
  const pageCount = pages.length;
  for (const item of agentBatch.results) {
    if (item?.object !== "agent" || typeof item.id !== "string" || !item.id) continue;
    const id = `agent:${item.id}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const kind = item.agent_type === "personal_agent" ? "Notion personal agent" : "Notion AI agent";
    pages.push({ id, title: item.name || kind, kind, parentId: null, url: "",
      lastEdited: item.last_edited_time ?? null, excerpt: [item.description, item.status].filter(Boolean).join(" · ") });
    if (item.instructions_page_id && ids.has(item.instructions_page_id)) {
      edges.push({ from: id, to: item.instructions_page_id, kind: "instructions" });
    }
  }
  const agents = pages.length - pageCount;
  const summaries = [
    pageBatch.issue || `${pageCount} ${pageBatch.more ? "recent " : ""}Notion pages`,
    agentBatch.issue || `${agents}${agentBatch.more ? "+" : ""} Notion AI agents`,
  ];
  const available = !pageBatch.issue || !agentBatch.issue;
  return { available, mode: available ? "live" : "unavailable", generatedAt: new Date().toISOString(),
    pages, edges, botPageMap: {}, stats: { pages: pageCount, agents, edges: edges.length, botsMapped: 0 },
    reason: summaries.join(" · ") };
}
