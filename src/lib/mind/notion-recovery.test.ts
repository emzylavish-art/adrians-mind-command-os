import assert from "node:assert/strict";
import { test } from "node:test";
import { runNotionTurn } from "./notion.ts";
import type { NotionOperation, NotionOperationStore } from "./notion-operation-store.ts";

const page = { object: "page", id: "p1", url: "https://www.notion.so/p1", properties: { Name: { title: [{ plain_text: "Roadmap" }] } } };
const block = (text: string, id = "appended-51") => ({ object: "block", id, type: "paragraph", paragraph: { rich_text: [{ plain_text: text }] } });
const text = "Append new note to the Notion page about roadmap";
function memoryStore() {
  const rows = new Map<string, NotionOperation>();
  const store: NotionOperationStore = {
    read: async (id) => rows.has(id) ? structuredClone(rows.get(id)!) : null,
    prepare: async (row) => { rows.set(row.id, structuredClone(row)); return row; },
    claim: async (id, fingerprint) => {
      const row = rows.get(id);
      if (!row || row.fingerprint !== fingerprint || !["prepared", "rejected"].includes(row.state)) return false;
      row.state = "dispatched"; return true;
    },
    finish: async (id, state, ids) => { const row = rows.get(id)!; row.state = state; if (ids) row.blockIds = ids; },
  };
  return { rows, store };
}

test("long-page append verifies its returned block ID and retry only reads that operation", async () => {
  const { store } = memoryStore();
  const calls: string[] = [];
  let allowRead = false;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    if (init?.method === "PATCH") return { ok: true, status: 200, json: async () => ({ results: [block("new note")] }) };
    if (url.endsWith("/search")) return { ok: true, status: 200, json: async () => ({ results: [page] }) };
    assert.ok(url.endsWith("/blocks/appended-51"));
    return { ok: allowRead, status: allowRead ? 200 : 503, json: async () => block("new note") };
  };
  const input = { token: "fake-token", disabled: false, text, pageId: "p1", fetch, operationStore: store, workspaceId: "workspace-A" };
  const held = await runNotionTurn({ ...input, confirmed: false });
  assert.ok(held.operationId);
  const accepted = await runNotionTurn({ ...input, confirmed: true, operationId: held.operationId });
  assert.equal(accepted.wrote, true);
  assert.equal(accepted.recovery, "verify_existing");
  allowRead = true;
  // Fresh request/store instance after a simulated reload reads the same durable operation.
  const recovered = await runNotionTurn({ ...input, confirmed: false, operationId: held.operationId });
  assert.equal(recovered.verified, true);
  assert.equal(calls.filter((call) => call.startsWith("PATCH")).length, 1);
  assert.equal(calls.some((call) => call.includes("children?page_size=50")), false);
});

test("lost write acknowledgement becomes uncertain and cannot dispatch again", async () => {
  const { store } = memoryStore();
  let writes = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; throw new Error("lost response after upstream acceptance"); }
    return { ok: true, status: 200, json: async () => ({ results: url.endsWith("/search") ? [page] : [] }) };
  };
  const input = { token: "fake", disabled: false, text, pageId: "p1", fetch, operationStore: store, workspaceId: "A" };
  const held = await runNotionTurn({ ...input, confirmed: false });
  const failed = await runNotionTurn({ ...input, confirmed: true, operationId: held.operationId });
  assert.equal(failed.outcome, "uncertain");
  assert.doesNotMatch(failed.error, /Nothing was changed/);
  const again = await runNotionTurn({ ...input, confirmed: true, operationId: held.operationId });
  assert.equal(again.recovery, "verify_existing");
  assert.equal(writes, 1);
});

test("permission failures remain typed and a changed workspace cannot reuse approval", async () => {
  const { store } = memoryStore();
  let writes = 0;
  const fetch = async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; return { ok: false, status: 403, json: async () => ({ code: "restricted_resource", message: "untrusted fake-token" }) }; }
    return { ok: true, status: 200, json: async () => ({ results: [page] }) };
  };
  const input = { token: "fake-token", disabled: false, text, pageId: "p1", fetch, operationStore: store, workspaceId: "A" };
  const held = await runNotionTurn({ ...input, confirmed: false });
  const denied = await runNotionTurn({ ...input, confirmed: true, operationId: held.operationId });
  assert.equal(denied.errorCode, "permission_required");
  assert.equal(denied.httpStatus, 403);
  assert.equal(denied.recovery, "reconnect");
  assert.doesNotMatch(denied.error, /fake-token/);
  const swapped = await runNotionTurn({ ...input, workspaceId: "B", confirmed: true, operationId: held.operationId });
  assert.equal(swapped.errorCode, "selection_changed");
  assert.equal(writes, 1);
});

test("legacy read-back follows pagination rather than repeating the append", async () => {
  let writes = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { writes++; return { ok: true, status: 200, json: async () => ({ results: [] }) }; }
    const body = url.endsWith("/search") ? { results: [page] }
      : url.includes("start_cursor") ? { results: [block("new note")] }
      : { results: Array.from({ length: 50 }, (_, i) => block(`old ${i}`, `old-${i}`)), has_more: true, next_cursor: "page-2" };
    return { ok: true, status: 200, json: async () => body };
  };
  const result = await runNotionTurn({ token: "fake", disabled: false, text, confirmed: true, pageId: "p1", fetch });
  assert.equal(result.verified, true);
  assert.equal(writes, 1);
});
