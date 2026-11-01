import type { NotionStopPoint } from "./types.ts";

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
