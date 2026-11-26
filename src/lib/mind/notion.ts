import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localDataPath } from "../local-data.ts";

export const NOTION_SETUP =
  "Notion is not connected. Open Plugins, connect your Notion workspace and choose the pages to share. Nothing was searched or updated. The secret is not shown here.";

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
  recovery?: "reconnect" | "permissions" | "page_unavailable" | "retry" | "workspace_removed";
  httpStatus?: number;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

let directory = localDataPath("mind-notion");

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

async function callNotion(fetchImpl: FetchLike, token: string, path: string, init: RequestInit): Promise<{ ok: true; body: unknown } | { ok: false; error: string; httpStatus?: number; recovery?: NotionTurn["recovery"] }> {
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
    return { ok: false, error: init.method === "PATCH" ? "The Notion write response was lost. Its outcome is unconfirmed; inspect the selected page before sending again." : "Notion could not be reached. Retry when the connection is available.", recovery: "retry" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) return { ok: false, error: "Notion rejected this workspace’s credential. Reconnect the same workspace in Plugins, then return to this request. No replacement workspace was selected.", httpStatus: 401, recovery: "reconnect" };
    if (response.status === 403) return { ok: false, error: "Notion denied this operation. In Plugins, reconnect the same workspace with the required permissions and share the selected page. A write must be reviewed again before it is sent.", httpStatus: 403, recovery: "permissions" };
    if (response.status === 404) return { ok: false, error: "The selected Notion page is unavailable to this connection. Restore page access in the same workspace or explicitly choose another destination and review it again.", httpStatus: 404, recovery: "page_unavailable" };
    const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Notion returned ${response.status}.`;
    return { ok: false, error: `${message} Nothing was invented.`, httpStatus: response.status, recovery: "retry" };
  }
  return { ok: true, body };
}

export async function runNotionTurn(input: {
  token: string | undefined;
  workspaceId?: string;
  disabled: boolean;
  text: string;
  confirmed: boolean;
  pageId: string | null;
  fetch: FetchLike;
}): Promise<NotionTurn> {
  const connection = notionConnection(input.token, input.disabled);
  if (connection.state !== "connected" || !input.token) return input.workspaceId && !input.token
    ? { ...empty("disconnected", "none", "The Notion workspace selected for this conversation is no longer connected. Reconnect that workspace in Plugins, or explicitly review a different destination. Nothing was sent to another workspace."), recovery: "workspace_removed" }
    : empty(connection.state, "none", connection.detail);
  const intent = parseNotionIntent(input.text);
  if (intent.action === "unclear") {
    return empty("connected", "unclear", "Say whether to search, read, or append, and name the page. Nothing was called.");
  }
  const query = intent.action === "search" ? intent.query : intent.query;
  const found = await callNotion(input.fetch, input.token, "/search", {
    method: "POST",
    body: JSON.stringify({ query: query.slice(0, 200), page_size: 8 }),
  });
  if (!found.ok) return { ...empty(found.httpStatus === 401 ? "disconnected" : "connected", intent.action, found.error), recovery: found.recovery, httpStatus: found.httpStatus };
  let pages = pagesFromSearch(found.body);
  if (input.pageId) pages = pages.filter((page) => page.id === input.pageId).concat(pages.filter((page) => page.id !== input.pageId));
  const picked = input.pageId ? pages.find((page) => page.id === input.pageId) ?? null : pages.length === 1 ? pages[0] : null;
  if (intent.action === "search") {
    return { ok: true, state: "connected", action: "search", needsConfirmation: false, ambiguous: false, pages, content: "", error: pages.length ? "" : "Notion returned no matching pages.", wrote: false, verified: false };
  }
  if (!picked && input.pageId) return { ...empty("connected", intent.action, "The selected Notion page was not returned for this workspace. Restore its access or explicitly select another page; no other search result was used."), pages, recovery: "page_unavailable" };
  if (!picked) {
    return { ok: false, state: "connected", action: intent.action, needsConfirmation: false, ambiguous: pages.length > 1, pages, content: "", error: pages.length ? "More than one Notion result matches. Pick one. Nothing was changed." : "Notion returned no matching page. Nothing was changed.", wrote: false, verified: false };
  }
  if (intent.action === "read") {
    const blocks = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children?page_size=20`, { method: "GET" });
    if (!blocks.ok) return { ...empty(blocks.httpStatus === 401 ? "disconnected" : "connected", "read", blocks.error), pages: [picked], recovery: blocks.recovery, httpStatus: blocks.httpStatus };
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
  if (!wrote.ok) return { ...empty(wrote.httpStatus === 401 ? "disconnected" : "connected", "append", wrote.error), pages: [picked], recovery: wrote.recovery, httpStatus: wrote.httpStatus };
  const check = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children?page_size=50`, { method: "GET" });
  const content = check.ok ? textFromBlocks(check.body) : "";
  const verified = content.includes(note);
  if (!check.ok || !verified) {
    return { ok: false, state: "connected", action: "append", needsConfirmation: false, ambiguous: false, pages: [picked], content, error: "Notion accepted a write, but the text was not found when the page was read back.", wrote: true, verified: false };
  }
  return { ok: true, state: "connected", action: "append", needsConfirmation: false, ambiguous: false, pages: [picked], content, error: "", wrote: true, verified: true };
}
