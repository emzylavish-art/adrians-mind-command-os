import { createHash, randomUUID } from "node:crypto";
import type { NotionOperation, NotionOperationStore } from "./notion-operation-store.ts";
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
  operationId?: string;
  executionId?: string;
  errorCode?: "permission_required" | "reconnect_required" | "rate_limited" | "unavailable" | "not_found" | "storage_unavailable" | "selection_changed";
  httpStatus?: number;
  recovery?: "reconnect" | "retry_read" | "verify_existing" | "confirm";
  outcome?: "not_dispatched" | "rejected" | "accepted" | "uncertain" | "verified";
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
  return { state: "connected", detail: "A Notion authorization is saved on the server. Page access and write permission are checked when used. A page change waits for confirmation." };
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

type NotionCallFailure = { ok: false; error: string; errorCode: NonNullable<NotionTurn["errorCode"]>; httpStatus?: number; uncertain: boolean };

async function callNotion(fetchImpl: FetchLike, token: string, path: string, init: RequestInit): Promise<{ ok: true; body: unknown } | NotionCallFailure> {
  let response: { ok: boolean; status: number; json: () => Promise<unknown> };
  try {
    response = await fetchImpl(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    });
  } catch {
    const write = init.method === "PATCH";
    return { ok: false, error: write ? "Notion did not return a write result. Its outcome is unknown; check the existing operation before any new write." : "Notion could not be reached. Retry this read when the connection recovers.", errorCode: "unavailable", uncertain: write };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const status = response.status;
    const errorCode = status === 401 ? "reconnect_required" : status === 403 ? "permission_required" : status === 404 ? "not_found" : status === 429 ? "rate_limited" : "unavailable";
    // Never display arbitrary provider bodies: they can contain credentials or private content.
    const error = status === 401 ? "Notion authorization is invalid or expired. Reconnect the same workspace, then confirm any new write again."
      : status === 403 ? "Notion denied this action. Reconnect the same workspace with permission for this page and action."
      : status === 404 ? "This Notion page is unavailable to the selected workspace. Check its shared pages."
      : status === 429 ? "Notion is rate limited. Wait before checking this operation again."
      : `Notion returned ${status}. Check the existing operation before retrying a write.`;
    return { ok: false, error, errorCode, httpStatus: status, uncertain: init.method === "PATCH" && status >= 500 };
  }
  return { ok: true, body };
}

function failureTurn(action: string, failed: NotionCallFailure, pages: NotionPage[] = []): NotionTurn {
  return { ...empty("connected", action, failed.error), pages, errorCode: failed.errorCode, httpStatus: failed.httpStatus,
    recovery: failed.uncertain ? "verify_existing" : failed.errorCode === "permission_required" || failed.errorCode === "reconnect_required" ? "reconnect" : "retry_read",
    outcome: failed.uncertain ? "uncertain" : "rejected" };
}

function returnedBlockIds(body: unknown): string[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) return [];
  return (body as { results: unknown[] }).results.flatMap((row) => row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" ? [(row as { id: string }).id] : []).slice(0, 100);
}

async function verifyAppend(input: { fetch: FetchLike; token: string; page: NotionPage; note: string; operation?: NotionOperation; store?: NotionOperationStore }): Promise<NotionTurn> {
  let content = "";
  let verified = false;
  const ids = input.operation?.blockIds ?? [];
  let failure: NotionCallFailure | null = null;
  if (ids.length) {
    for (const id of ids) {
      const result = await callNotion(input.fetch, input.token, `/blocks/${encodeURIComponent(id)}`, { method: "GET" });
      if (!result.ok) { failure = result; break; }
      content += textFromBlocks({ results: [result.body] }) + "\n";
    }
    verified = !failure && content.trim() === input.note;
  } else {
    // Legacy/malformed append receipts still use a bounded paginated read, never another append.
    let cursor: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page += 1) {
      const result = await callNotion(input.fetch, input.token, `/blocks/${input.page.id}/children?page_size=50${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET" });
      if (!result.ok) { failure = result; break; }
      const text = textFromBlocks(result.body);
      content = (content + "\n" + text).trim().slice(-4000);
      if (text.split("\n").includes(input.note)) { verified = true; break; }
      const body = result.body as { has_more?: boolean; next_cursor?: string } | null;
      if (!body?.has_more || !body.next_cursor || seen.has(body.next_cursor)) break;
      cursor = body.next_cursor;
      seen.add(cursor);
    }
  }
  if (verified && input.store && input.operation) {
    try { await input.store.finish(input.operation.id, "verified"); }
    catch { /* Accepted state still prevents re-dispatch if recording verification is unavailable. */ }
  }
  return { ok: verified, state: "connected", action: "append", needsConfirmation: false, ambiguous: false, pages: [input.page], content,
    error: verified ? "" : failure?.error ?? "Notion accepted or may have accepted this write, but its text was not found during the bounded check. Check the existing operation; do not append it again.",
    wrote: input.operation?.state === "accepted" || input.operation?.state === "verified" || verified,
    verified, operationId: input.operation?.id, outcome: verified ? "verified" : input.operation?.state === "accepted" ? "accepted" : "uncertain",
    recovery: verified ? undefined : "verify_existing", errorCode: failure?.errorCode, httpStatus: failure?.httpStatus };
}

export async function runNotionTurn(input: {
  token: string | undefined;
  disabled: boolean;
  text: string;
  confirmed: boolean;
  pageId: string | null;
  fetch: FetchLike;
  operationId?: string;
  workspaceId?: string;
  operationStore?: NotionOperationStore;
}): Promise<NotionTurn> {
  const connection = notionConnection(input.token, input.disabled);
  if (connection.state !== "connected" || !input.token) return empty(connection.state, "none", connection.detail);
  const intent = parseNotionIntent(input.text);
  if (intent.action === "unclear") {
    return empty("connected", "unclear", "Say whether to search, read, or append, and name the page. Nothing was called.");
  }
  let existing: NotionOperation | null = null;
  if (intent.action === "append" && input.operationId && input.operationStore) {
    try { existing = await input.operationStore.read(input.operationId); }
    catch { return { ...empty("connected", "append", "Write recovery storage is unavailable. Nothing new was sent."), errorCode: "storage_unavailable", operationId: input.operationId }; }
    if (!existing || existing.workspaceId !== (input.workspaceId ?? "") || (input.pageId && existing.page.id !== input.pageId)) {
      return { ...empty("connected", "append", "The saved operation does not belong to this selected page and workspace. Start a fresh confirmation."), errorCode: "selection_changed" };
    }
    // Query/page selection can normalize between preparation and confirmation, so bind note + exact stored page.
    const expected = createHash("sha256").update(JSON.stringify([input.workspaceId ?? "", intent.note, existing.page.id])).digest("hex");
    if (existing.fingerprint !== expected) return { ...empty("connected", "append", "The write text or destination changed. Start a fresh confirmation."), errorCode: "selection_changed" };
    if (["dispatched", "accepted", "verified", "uncertain"].includes(existing.state)) {
      return verifyAppend({ fetch: input.fetch, token: input.token, page: existing.page, note: intent.note, operation: existing, store: input.operationStore });
    }
  }
  const query = intent.query;
  const found = await callNotion(input.fetch, input.token, "/search", {
    method: "POST",
    body: JSON.stringify({ query: query.slice(0, 200), page_size: 8 }),
  });
  if (!found.ok) return failureTurn(intent.action, found);
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
    if (!blocks.ok) return failureTurn("read", blocks, [picked]);
    return { ok: true, state: "connected", action: "read", needsConfirmation: false, ambiguous: false, pages: [picked], content: textFromBlocks(blocks.body), error: "", wrote: false, verified: false };
  }
  const note = intent.note.slice(0, 1500);
  const boundFingerprint = createHash("sha256").update(JSON.stringify([input.workspaceId ?? "", note, picked.id])).digest("hex");
  let operation = existing;
  if (input.operationStore && !operation) {
    try {
      operation = await input.operationStore.prepare({ id: randomUUID(), workspaceId: input.workspaceId ?? "", fingerprint: boundFingerprint, page: picked, state: "prepared", blockIds: [] });
    } catch {
      return { ...empty("connected", "append", "Write recovery storage is unavailable. Nothing new was sent."), errorCode: "storage_unavailable" };
    }
  }
  // A production confirmation must refer to the prepared, exact operation; a fresh boolean cannot authorize a different target.
  if (!input.confirmed || (input.operationStore && !existing)) {
    return { ok: false, state: "connected", action: "append", needsConfirmation: true, ambiguous: false, pages: [picked], content: "", error: `Append to “${picked.title}” only after you confirm. Nothing was written.`, wrote: false, verified: false,
      operationId: operation?.id, recovery: "confirm", outcome: "not_dispatched" };
  }
  if (input.operationStore && operation) {
    let claimed = false;
    try { claimed = await input.operationStore.claim(operation.id, boundFingerprint); }
    catch { return { ...empty("connected", "append", "Write recovery storage is unavailable. Nothing new was sent."), errorCode: "storage_unavailable", operationId: operation.id }; }
    if (!claimed) {
      const current = await input.operationStore.read(operation.id);
      return verifyAppend({ fetch: input.fetch, token: input.token, page: picked, note, operation: current ?? { ...operation, state: "uncertain" }, store: input.operationStore });
    }
  }
  const wrote = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children`, {
    method: "PATCH",
    body: JSON.stringify({ children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: note } }] } }] }),
  });
  if (!wrote.ok) {
    if (operation && input.operationStore) await input.operationStore.finish(operation.id, wrote.uncertain ? "uncertain" : "rejected").catch(() => undefined);
    return { ...failureTurn("append", wrote, [picked]), operationId: operation?.id };
  }
  const accepted: NotionOperation = { id: operation?.id ?? "", workspaceId: input.workspaceId ?? "", fingerprint: boundFingerprint, page: picked, state: "accepted", blockIds: returnedBlockIds(wrote.body) };
  if (operation && input.operationStore) {
    try { await input.operationStore.finish(operation.id, "accepted", accepted.blockIds); }
    catch {
      return { ...empty("connected", "append", "Notion accepted the write, but its receipt could not be saved. Check this existing operation; do not append it again."), pages: [picked], wrote: true, operationId: operation.id, outcome: "accepted", recovery: "verify_existing", errorCode: "storage_unavailable" };
    }
  }
  return verifyAppend({ fetch: input.fetch, token: input.token, page: picked, note, operation: accepted, store: input.operationStore });
}
