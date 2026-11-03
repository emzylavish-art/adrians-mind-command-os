import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NOTION_SETUP =
  "Notion is not connected. Set NOTION_TOKEN (or NOTION_API_KEY) on the server, or configure Notion OAuth (NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, NOTION_OAUTH_REDIRECT_URI), then share pages with the integration. Nothing was searched or updated. The secret is not shown here.";

export type NotionPage = { id: string; title: string; url: string; kind: "page" | "database" };

export type NotionIntent =
  | { action: "search"; query: string }
  | { action: "read"; query: string }
  | { action: "append"; query: string; note: string }
  | { action: "unclear" };

export type NotionTurn = {
  ok: boolean;
  state: "unconfigured" | "disconnected" | "connected";
  action: string;
  needsConfirmation: boolean;
  ambiguous: boolean;
  pages: NotionPage[];
  content: string;
  error: string;
  wrote: boolean;
  verified: boolean;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let directory = join(process.cwd(), ".data", "mind-notion");

export function setNotionPrefDirectory(next: string) {
  directory = next;
}

function prefFile(userId: string) {
  return join(directory, `${createHash("sha256").update(userId).digest("hex")}.json`);
}

export function readNotionPref(userId: string): { disabled: boolean; ownerId: string | null } {
  try {
    const parsed = JSON.parse(readFileSync(prefFile(userId), "utf8")) as { disabled?: boolean; ownerId?: string };
    return { disabled: parsed.disabled === true, ownerId: typeof parsed.ownerId === "string" ? parsed.ownerId : null };
  } catch {
    return { disabled: false, ownerId: null };
  }
}

export function writeNotionPref(userId: string, disabled: boolean) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(prefFile(userId), JSON.stringify({ disabled, ownerId: userId }));
}

export function notionConnection(token: string | undefined, disabled: boolean): { state: NotionTurn["state"]; detail: string } {
  if (!token?.trim()) return { state: "unconfigured", detail: NOTION_SETUP };
  if (disabled) return { state: "disconnected", detail: "Notion is disconnected for this workspace. The server secret stays hidden. Nothing is called." };
  return { state: "connected", detail: "Notion is connected on the server. The secret is not shown. Search reads the live API. A page change waits for confirmation." };
}

export function parseNotionIntent(text: string): NotionIntent {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (!/\bnotion\b/.test(lower)) return { action: "unclear" };
  if (/\b(append|add|update|write)\b/.test(lower)) {
    const note = raw.match(/\b(?:append|add|write)\s+(.+?)\s+(?:to|onto)\b/i)?.[1]?.trim();
    const query = raw.match(/\b(?:page|about|called|titled)\s+(.+?)(?:\.|$)/i)?.[1]?.trim() || raw.replace(/\bnotion\b/gi, "").trim();
    return { action: "append", query: query.slice(0, 200), note: (note || raw).slice(0, 1500) };
  }
  if (/\b(read|open|show)\b/.test(lower)) {
    const query = raw.match(/\b(?:page|about|called|titled)\s+(.+?)(?:\.|$)/i)?.[1]?.trim() || raw.replace(/\bnotion\b/gi, "").trim();
    return { action: "read", query: query.slice(0, 200) };
  }
  if (/\b(search|find)\b/.test(lower)) {
    const query = raw.replace(/^.*\b(?:for|about)\s+/i, "").replace(/\bnotion\b/gi, "").trim();
    return { action: "search", query: (query || raw).slice(0, 200) };
  }
  return { action: "unclear" };
}

function titleFrom(item: Record<string, unknown>): string {
  if (Array.isArray(item.title)) {
    const text = item.title.map((part) => (part && typeof part === "object" && "plain_text" in part ? String(part.plain_text ?? "") : "")).join("").trim();
    if (text) return text;
  }
  const properties = item.properties;
  if (properties && typeof properties === "object") {
    for (const prop of Object.values(properties as Record<string, unknown>)) {
      if (!prop || typeof prop !== "object" || !("title" in prop) || !Array.isArray(prop.title)) continue;
      const text = prop.title.map((part) => (part && typeof part === "object" && "plain_text" in part ? String(part.plain_text ?? "") : "")).join("").trim();
      if (text) return text;
    }
  }
  return item.object === "database" ? "Untitled database" : "Untitled";
}

export function pagesFromSearch(body: unknown): NotionPage[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) return [];
  const pages: NotionPage[] = [];
  for (const item of (body as { results: unknown[] }).results) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.object !== "page" && row.object !== "database") continue;
    const id = typeof row.id === "string" ? row.id : "";
    const url = typeof row.url === "string" && /^https:\/\//.test(row.url) ? row.url : "";
    if (!id || !url) continue;
    pages.push({ id, title: titleFrom(row).slice(0, 180), url, kind: row.object });
  }
  return pages;
}

export function textFromBlocks(body: unknown): string {
  if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) return "";
  const lines: string[] = [];
  for (const item of (body as { results: unknown[] }).results) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    const payload = type ? block[type] : null;
    const rich = payload && typeof payload === "object" && "rich_text" in payload ? payload.rich_text : null;
    if (!Array.isArray(rich)) continue;
    const line = rich.map((part) => (part && typeof part === "object" && "plain_text" in part ? String(part.plain_text ?? "") : "")).join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n").slice(0, 4000);
}

function empty(state: NotionTurn["state"], action: string, error: string): NotionTurn {
  return { ok: false, state, action, needsConfirmation: false, ambiguous: false, pages: [], content: "", error, wrote: false, verified: false };
}

async function callNotion(fetchImpl: FetchLike, token: string, path: string, init: RequestInit): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
    });
  } catch {
    return { ok: false, error: "Notion could not be reached. Nothing was changed." };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Notion returned ${response.status}.`;
    return { ok: false, error: `${message} Nothing was invented.` };
  }
  return { ok: true, body };
}


/** Live probe — never report connected from token presence alone. */
export async function probeNotionConnection(input: {
  token: string | undefined;
  disabled: boolean;
  fetch: FetchLike;
}): Promise<{ state: NotionTurn["state"]; detail: string }> {
  const base = notionConnection(input.token, input.disabled);
  if (base.state !== "connected" || !input.token?.trim()) return base;
  const result = await callNotion(input.fetch, input.token.trim(), "/users/me", { method: "GET" });
  if (!result.ok) {
    return {
      state: "unconfigured",
      detail: `Notion credentials are present but the API rejected them. ${result.error} Fix NOTION_TOKEN / OAuth and share pages. Nothing was searched.`,
    };
  }
  return {
    state: "connected",
    detail: "Notion answered users/me. The secret is not shown. Search reads the live API. A page change waits for confirmation.",
  };
}

export async function runNotionTurn(input: {
  token: string | undefined;
  disabled: boolean;
  text: string;
  confirmed: boolean;
  pageId: string | null;
  fetch: FetchLike;
}): Promise<NotionTurn> {
  const connection = notionConnection(input.token, input.disabled);
  if (connection.state !== "connected" || !input.token) return empty(connection.state, "none", connection.detail);
  const intent = parseNotionIntent(input.text);
  if (intent.action === "unclear") {
    return empty("connected", "unclear", "Say whether to search, read, or append, and name the page. Nothing was called.");
  }
  const query = intent.action === "search" ? intent.query : intent.query;
  const found = await callNotion(input.fetch, input.token, "/search", {
    method: "POST",
    body: JSON.stringify({ query: query.slice(0, 200), page_size: 8 }),
  });
  if (!found.ok) return empty("connected", intent.action, found.error);
  let pages = pagesFromSearch(found.body);
  if (input.pageId) pages = pages.filter((page) => page.id === input.pageId).concat(pages.filter((page) => page.id !== input.pageId));
  const picked = input.pageId ? pages.find((page) => page.id === input.pageId) ?? null : pages.length === 1 ? pages[0] : null;
  if (intent.action === "search") {
    return { ok: true, state: "connected", action: "search", needsConfirmation: false, ambiguous: false, pages, content: "", error: pages.length ? "" : "Notion returned no matching pages.", wrote: false, verified: false };
  }
  if (!picked) {
    return { ok: false, state: "connected", action: intent.action, needsConfirmation: false, ambiguous: pages.length > 1, pages, content: "", error: pages.length ? "More than one Notion result matches. Pick one. Nothing was changed." : "Notion returned no matching page. Nothing was changed.", wrote: false, verified: false };
  }
  if (intent.action === "read") {
    const blocks = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children?page_size=20`, { method: "GET" });
    if (!blocks.ok) return { ...empty("connected", "read", blocks.error), pages: [picked] };
    return { ok: true, state: "connected", action: "read", needsConfirmation: false, ambiguous: false, pages: [picked], content: textFromBlocks(blocks.body), error: "", wrote: false, verified: false };
  }
  if (!input.confirmed) {
    return { ok: false, state: "connected", action: "append", needsConfirmation: true, ambiguous: false, pages: [picked], content: "", error: `Append to “${picked.title}” only after you confirm. Nothing was written.`, wrote: false, verified: false };
  }
  const note = intent.note.slice(0, 1500);
  const wrote = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children`, {
    method: "PATCH",
    body: JSON.stringify({
      children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: note } }] } }],
    }),
  });
  if (!wrote.ok) return { ...empty("connected", "append", wrote.error), pages: [picked] };
  const check = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children?page_size=50`, { method: "GET" });
  const content = check.ok ? textFromBlocks(check.body) : "";
  const verified = content.includes(note);
  if (!check.ok || !verified) {
    return { ok: false, state: "connected", action: "append", needsConfirmation: false, ambiguous: false, pages: [picked], content, error: "Notion accepted a write, but the text was not found when the page was read back.", wrote: true, verified: false };
  }
  return { ok: true, state: "connected", action: "append", needsConfirmation: false, ambiguous: false, pages: [picked], content, error: "", wrote: true, verified: true };
}
