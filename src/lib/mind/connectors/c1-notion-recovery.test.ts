import assert from "node:assert/strict";
import { after, test } from "node:test";
import { runInNewContext } from "node:vm";
import { getSql, dbSource } from "../../db.ts";
import { runNotionTurn } from "../notion.ts";
import { notionObservationMessage } from "../notion-operation-status.ts";
import { observationFromTurn, readNotionObservations, saveNotionObservation } from "./notion-operation-status.server.ts";
import { safeOAuthReturnPath, rememberOAuthReturn } from "./oauth-return.ts";
import { oauthCallbackHtml } from "./oauth-callback-html.ts";
import type { StoredConnection } from "./store.ts";

const grant: StoredConnection = { connector: "notion", ownerId: "c1-notion", workspaceId: "A", grantGeneration: "grant-A", accessTokenEnc: "encrypted-fixture", connectedAt: new Date().toISOString() };
const page = { object: "page", id: "P", url: "https://notion.so/P", properties: { title: { title: [{ plain_text: "Page P" }] } } };
function wire(status: number, message: string) {
  const calls: string[] = [];
  return { calls, fetch: async (url: string, init?: RequestInit) => {
    calls.push(String(init?.method));
    if (url.endsWith("/search")) return { ok: true, status: 200, json: async () => ({ results: [page] }) };
    if (init?.method === "PATCH") return { ok: status < 400, status, json: async () => ({ code: "restricted_resource", message }) };
    return { ok: true, status: 200, json: async () => ({ results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "a note" }] } }] }) };
  } };
}
const input = { token: "fixture-token", disabled: false, text: "Append a note to Notion page P", pageId: "P", confirmed: true };

test("C1 AA001: partial access keeps reads, records typed denial, and requires new approval after repair", async () => {
  const denied = wire(403, "Insufficient permissions to perform this operation");
  const result = await runNotionTurn({ ...input, fetch: denied.fetch });
  assert.equal(result.state, "connected");
  assert.equal(result.wrote, false);
  assert.equal(result.verified, false);
  assert.equal(result.failure?.httpStatus, 403);
  assert.equal(result.failure?.code, "restricted_resource");
  assert.equal(result.failure?.recovery, "review_access");
  assert.deepEqual(denied.calls, ["POST", "PATCH"]);
  const read = await runNotionTurn({ ...input, text: "Read Notion page P", fetch: denied.fetch });
  assert.equal(read.ok, true);
  const pending = await runNotionTurn({ ...input, confirmed: false, token: "renewed-fixture", fetch: denied.fetch });
  assert.equal(pending.needsConfirmation, true);
  const oldApproval = await runNotionTurn({ ...input, grantGeneration: "renewed-grant", reviewedGrantGeneration: "old-grant", fetch: denied.fetch });
  assert.equal(oldApproval.needsConfirmation, true);
  const missingApproval = await runNotionTurn({ ...input, grantGeneration: "renewed-grant", fetch: denied.fetch });
  assert.equal(missingApproval.needsConfirmation, true);
  assert.equal(denied.calls.filter((method) => method === "PATCH").length, 1);
  const limit = await runNotionTurn({ ...input, fetch: wire(403, "Workspace block limit exceeded").fetch });
  assert.equal(limit.failure?.recovery, "workspace_limit");
  assert.equal(limit.failure?.kind, "block_limit");
});

test("C1 AA001: operation status persists by owner/workspace/page/action; unrelated reads never clear append denial", async () => {
  assert.equal(dbSource, "pglite");
  const sql = await getSql();
  const denied = await runNotionTurn({ ...input, fetch: wire(403, "Insufficient permissions").fetch });
  const observation = observationFromTurn(grant, denied, "chat-P");
  assert.ok(observation);
  await saveNotionObservation(sql, grant.ownerId, observation);
  const read = await runNotionTurn({ ...input, text: "Read Notion page P", fetch: wire(200, "").fetch });
  await saveNotionObservation(sql, grant.ownerId, observationFromTurn(grant, read)!);
  const rows = await readNotionObservations(sql, grant.ownerId, "A");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.operation === "append")?.ok, false);
  assert.deepEqual(await readNotionObservations(sql, "other-owner", "A"), []);
  assert.deepEqual(await readNotionObservations(sql, grant.ownerId, "B"), []);
  assert.match(notionObservationMessage(observation, "grant-B"), /Access updated; append.*has not been verified/);
  assert.equal(JSON.stringify(rows).includes("fixture-token"), false);
  assert.equal(JSON.stringify(rows).includes("a note"), false, "retrieved contents and intended write text are not status metadata");
  const repaired = await runNotionTurn({ ...input, fetch: wire(200, "").fetch });
  assert.equal(repaired.verified, true);
  await saveNotionObservation(sql, grant.ownerId, observationFromTurn({ ...grant, grantGeneration: "grant-B" }, repaired)!);
  assert.equal((await readNotionObservations(sql, grant.ownerId, "A")).find((row) => row.operation === "append")?.ok, true);
  await saveNotionObservation(sql, grant.ownerId, { ...observation, observedAt: "2020-01-01T00:00:00.000Z" });
  assert.equal((await readNotionObservations(sql, grant.ownerId, "A")).find((row) => row.operation === "append")?.ok, true, "an older in-flight denied action cannot overwrite a newer repaired result");
});

test("C1 AA001: OAuth returns to the interrupted chat only for matching state, never replays an approval", async () => {
  assert.equal(safeOAuthReturnPath("https://other.example/?chat=one"), "/");
  assert.equal(safeOAuthReturnPath("//other.example/?chat=one"), "/");
  assert.equal(safeOAuthReturnPath("/?section=chat&chat=one&confirmed=true&token=secret"), "/?section=chat&chat=one");
  const storage = new Map<string, string>();
  const state = "a".repeat(40);
  rememberOAuthReturn({ setItem: (key, value) => { storage.set(key, value); } }, "notion", `https://notion.so/?state=${state}`, "/?section=chat&chat=one");
  const response = await oauthCallbackHtml({ connector: "notion", ok: true, message: "Access updated. No write was replayed." }).text();
  const script = response.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  const link: { href?: string; textContent?: string } = {};
  runInNewContext(script, { URL, URLSearchParams, location: { origin: "https://mind.example", search: `?state=${state}` }, window: { location: { origin: "https://mind.example" } }, sessionStorage: { getItem: (key: string) => storage.get(key), removeItem: (key: string) => storage.delete(key) }, document: { getElementById: () => ({ setAttribute: (_: string, href: string) => { link.href = href; }, set textContent(value: string) { link.textContent = value; } }) } });
  assert.equal(link.href, "/?section=chat&chat=one");
  assert.match(link.textContent ?? "", /review before writing/);
  assert.equal(storage.size, 0);
});

// Close the embedded fixture backend so the normal Node test worker exits cleanly.
after(async () => {
  const globals = globalThis as typeof globalThis & { __pgBootstrapPromise__?: Promise<void>; __pgliteInstance__?: Promise<{ close(): Promise<void> }> };
  await globals.__pgBootstrapPromise__;
  if (globals.__pgliteInstance__) await (await globals.__pgliteInstance__).close();
});
