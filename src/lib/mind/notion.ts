import type { NotionWriteOutcome } from "./notion-write-receipt.ts";
import { classifyNotionFailure, type NotionFailureEvidence, type NotionOperation as NotionOperationKind } from "./notion-operation-status.ts";
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
  failure?: NotionFailureEvidence;
  workspaceId?: string;
  grantGeneration?: string;
  statusSaved?: boolean;
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
  recovery?: "reconnect" | "retry_read" | "verify_existing" | "confirm" | "permissions" | "page_unavailable" | "workspace_removed";
  outcome?: "not_dispatched" | "rejected" | "accepted" | "uncertain" | "verified";
  nextCursor?: string | null;
  writeOutcome?: NotionWriteOutcome;
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
    const note = raw.match(/\b(?:append|add|write)\s+([\s\S]+?)\s+(?:to|onto)\s+(?:the\s+)?Notion\b/i)?.[1]?.trim()
      ?? raw.match(/\b(?:append|add|write)\s+([\s\S]+?)\s+(?:to|onto)\b/i)?.[1]?.trim();
    const query = raw.match(/\b(?:page|about|called|titled)\s+(.+?)(?:\.|$)/i)?.[1]?.trim() || raw.replace(/\bnotion\b/gi, "").trim();
    return { action: "append", query: query.slice(0, 200), note: note || raw };
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

function blockText(body: unknown): string {
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
  return lines.join("\n");
}

export function textFromBlocks(body: unknown): string {
  return blockText(body).slice(0, 4000);
}

function empty(state: NotionTurn["state"], action: string, error: string): NotionTurn {
  return { ok: false, state, action, needsConfirmation: false, ambiguous: false, pages: [], content: "", error, wrote: false, verified: false };
}

type NotionCallFailure = { ok: false; error: string; errorCode: NonNullable<NotionTurn["errorCode"]>; httpStatus?: number; uncertain: boolean; body?: unknown };

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
    return { ok: false, error, errorCode, body, httpStatus: status, uncertain: init.method === "PATCH" && status >= 500 };
  }
  return { ok: true, body };
}

function failureTurn(action: NotionOperationKind, failed: NotionCallFailure, pages: NotionPage[] = []): NotionTurn {
  return { ...empty("connected", action, failed.error), pages, failure: classifyNotionFailure(action, failed.httpStatus ?? 0, failed.body), errorCode: failed.errorCode, httpStatus: failed.httpStatus,
    recovery: failed.uncertain ? "verify_existing" : failed.errorCode === "permission_required" ? "permissions" : failed.errorCode === "reconnect_required" ? "reconnect" : "retry_read",
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
  if (ids.length === 1) {
    for (const id of ids) {
      const result = await callNotion(input.fetch, input.token, `/blocks/${encodeURIComponent(id)}`, { method: "GET" });
      if (!result.ok) { failure = result; break; }
      const block = result.body as { id?: string; parent?: { page_id?: string; block_id?: string } } | null;
      const parentId = block?.parent?.page_id ?? block?.parent?.block_id;
      if (block?.id !== id || !parentId || parentId.replaceAll("-", "") !== input.page.id.replaceAll("-", "")) break;
      content += blockText({ results: [result.body] }) + "\n";
    }
    verified = !failure && content.trim() === input.note;
  } else {
    // Identical old text cannot establish which request created a block.
    return { ...empty("connected", "append", "This operation has no returned block identity. Inspect the original page; this operation will not be repeated."),
      pages: [input.page], wrote: input.operation?.state === "accepted", operationId: input.operation?.id,
      outcome: input.operation?.state === "accepted" ? "accepted" : "uncertain", recovery: "verify_existing" };
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
  cursor?: string | null;
  grantGeneration?: string;
  mayDispatch?: () => Promise<boolean>;
}): Promise<NotionTurn> {
  if (input.text.length > 8000) return empty("connected", "none", "Notion commands support up to 8,000 characters. Shorten this request before submitting it.");
  if (!input.token && input.workspaceId) return { ...empty("disconnected", "none", "The selected Notion workspace is unavailable. Reconnect the original workspace."), recovery: "workspace_removed" };
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
    if (existing.fingerprint.split(":")[0] !== expected) return { ...empty("connected", "append", "The write text or destination changed. Start a fresh confirmation."), errorCode: "selection_changed" };
    if (["dispatched", "accepted", "verified", "uncertain"].includes(existing.state)) {
      return verifyAppend({ fetch: input.fetch, token: input.token, page: existing.page, note: intent.note, operation: existing, store: input.operationStore });
    }
  }
  let pages: NotionPage[] = [];
  let nextCursor: string | null = null;
  if (input.pageId && intent.action !== "search") {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.pageId)) return empty("connected", intent.action, "The selected Notion page ID is invalid. Nothing was changed.");
    // Selection is an exact destination. Search ordering and changed page grants
    // must never replace it or make it disappear from the first result page.
    const selected = await callNotion(input.fetch, input.token, `/pages/${encodeURIComponent(input.pageId)}`, { method: "GET" });
    if (!selected.ok) return failureTurn(intent.action, selected);
    pages = pagesFromSearch({ results: [selected.body] });
    if (pages[0]?.id !== input.pageId) return { ...empty("connected", intent.action, "The selected Notion page is unavailable in this workspace. Check its shared pages."), recovery: "page_unavailable" };
  } else {
    const found = await callNotion(input.fetch, input.token, "/search", {
      method: "POST",
      body: JSON.stringify({ query: intent.query.slice(0, 200), page_size: 25, ...(input.cursor ? { start_cursor: input.cursor } : {}) }),
    });
    if (!found.ok) return failureTurn(intent.action, found);
    pages = pagesFromSearch(found.body);
    const body = found.body as { has_more?: boolean; next_cursor?: unknown } | null;
    nextCursor = body?.has_more && typeof body.next_cursor === "string" ? body.next_cursor : null;
  }
  const picked = input.pageId ? pages.find((page) => page.id === input.pageId) ?? null : pages.length === 1 && !nextCursor && !input.cursor ? pages[0] : null;
  if (intent.action === "search") {
    return { ok: true, state: "connected", action: "search", needsConfirmation: false, ambiguous: false, pages, nextCursor, content: "", error: pages.length ? "" : "Notion returned no matching pages.", wrote: false, verified: false };
  }
  if (!picked) {
    return { ok: false, state: "connected", action: intent.action, needsConfirmation: false, ambiguous: pages.length > 1 || Boolean(nextCursor) || Boolean(input.cursor), pages, nextCursor, content: "", error: pages.length ? "More than one Notion result matches. Pick one. Nothing was changed." : "Notion returned no matching page. Nothing was changed.", wrote: false, verified: false };
  }
  if (intent.action === "read") {
    const blocks = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children?page_size=20`, { method: "GET" });
    if (!blocks.ok) return failureTurn("read", blocks, [picked]);
    return { ok: true, state: "connected", action: "read", needsConfirmation: false, ambiguous: false, pages: [picked], content: textFromBlocks(blocks.body), error: "", wrote: false, verified: false };
  }
  const note = intent.note;
  if (!input.operationStore || !input.workspaceId) return { ...empty("connected", "append", "Select a workspace and prepare a durable write approval before appending."), errorCode: "storage_unavailable" };
  const contentFingerprint = createHash("sha256").update(JSON.stringify([input.workspaceId ?? "", note, picked.id])).digest("hex");
  const boundFingerprint = input.grantGeneration ? contentFingerprint + ":" + input.grantGeneration : contentFingerprint;
  if (existing && (existing.fingerprint !== boundFingerprint || existing.state === "rejected")) {
    return { ...empty("connected", "append", "The prior approval is no longer valid. Review a new append in this workspace."), errorCode: "selection_changed" };
  }
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
  if (input.mayDispatch && !await input.mayDispatch()) {
    if (operation) await input.operationStore.finish(operation.id, "rejected");
    return { ...empty("connected", "append", "The connection changed or execution stopped before dispatch. Review the operation again."), errorCode: "selection_changed" };
  }
  // Keep one paragraph identity for readback even when Notion requires multiple rich-text spans.
  const spans = note.match(/[\s\S]{1,1000}/gu) ?? [];
  const wrote = await callNotion(input.fetch, input.token, `/blocks/${picked.id}/children`, {
    method: "PATCH",
    body: JSON.stringify({ children: [{ object: "block", type: "paragraph", paragraph: { rich_text: spans.map((content) => ({ type: "text", text: { content } })) } }] }),
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
