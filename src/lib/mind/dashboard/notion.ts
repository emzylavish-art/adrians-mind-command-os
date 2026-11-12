import type { NotionStopPoint } from "./types.ts";
import type { NotionGraph } from "./notion-graph-core.ts";

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

/** Live graph pages from the Notion search API. Returns null when no token or no pages. */
export async function fetchNotionGraph(
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<NotionGraph | null> {
  if (!token?.trim()) return null;
  try {
    const res = await fetchImpl("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "Adrian", page_size: 20, filter: { property: "object", value: "page" } }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{
        id?: string;
        url?: string;
        last_edited_time?: string;
        parent?: { page_id?: string };
        properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
      }>;
    };
    const pages = (json.results ?? []).flatMap((item) => {
      const id = item.id ?? "";
      const title = titleFromSearch(item);
      if (!id || !title) return [];
      return [{
        id,
        title,
        url: item.url || `https://www.notion.so/${id.replace(/-/g, "")}`,
        parentId: item.parent?.page_id ?? null,
        lastEdited: item.last_edited_time ?? null,
        excerpt: "",
        kind: "page",
      }];
    }).slice(0, 48);
    if (!pages.length) return null;
    const ids = new Set(pages.map((page) => page.id));
    const edges = pages.flatMap((page) => page.parentId && ids.has(page.parentId) ? [{ from: page.parentId, to: page.id, kind: "parent" }] : []);
    return {
      available: true,
      mode: "live",
      generatedAt: new Date().toISOString(),
      pages,
      edges,
      botPageMap: {},
      stats: { pages: pages.length, edges: edges.length, botsMapped: 0 },
      reason: "Live Notion search.",
    };
  } catch {
    return null;
  }
}
