import assert from "node:assert/strict";
import { test } from "node:test";
import { runNotionTurn } from "./notion.ts";
import { memoryStore } from "./notion-test-fixture.ts";

const page = { object: "page", id: "p1", url: "https://www.notion.so/p1", properties: { Name: { title: [{ plain_text: "Roadmap" }] } } };
const block = (text: string, id = "appended-51") => ({ object: "block", id, parent: { page_id: "p1" }, type: "paragraph", paragraph: { rich_text: [{ plain_text: text }] } });
const text = "Append new note to the Notion page about roadmap";
test("long-page append verifies its returned block ID and retry only reads that operation", async () => {
  const { store } = memoryStore();
  const calls: string[] = [];
  let allowRead = false;
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    if (url.endsWith("/pages/p1")) return { ok: true, status: 200, json: async () => page };
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
    if (url.endsWith("/pages/p1")) return { ok: true, status: 200, json: async () => page };
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
  const fetch = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/pages/p1")) return { ok: true, status: 200, json: async () => page };
    if (init?.method === "PATCH") { writes++; return { ok: false, status: 403, json: async () => ({ code: "restricted_resource", message: "untrusted fake-token" }) }; }
    return { ok: true, status: 200, json: async () => ({ results: [page] }) };
  };
  const input = { token: "fake-token", disabled: false, text, pageId: "p1", fetch, operationStore: store, workspaceId: "A" };
  const held = await runNotionTurn({ ...input, confirmed: false });
  const denied = await runNotionTurn({ ...input, confirmed: true, operationId: held.operationId });
  assert.equal(denied.errorCode, "permission_required");
  assert.equal(denied.httpStatus, 403);
  assert.equal(denied.recovery, "permissions");
  assert.doesNotMatch(denied.error, /fake-token/);
  const swapped = await runNotionTurn({ ...input, workspaceId: "B", confirmed: true, operationId: held.operationId });
  assert.equal(swapped.errorCode, "selection_changed");
  assert.equal(writes, 1);
});

test("a later page containing identical text cannot verify a legacy response without a block ID", async () => {
  let writes = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/pages/p1")) return { ok: true, status: 200, json: async () => page };
    if (init?.method === "PATCH") { writes++; return { ok: true, status: 200, json: async () => ({ results: [] }) }; }
    const body = url.endsWith("/search") ? { results: [page] }
      : url.includes("start_cursor") ? { results: [block("new note")] }
      : { results: Array.from({ length: 50 }, (_, i) => block(`old ${i}`, `old-${i}`)), has_more: true, next_cursor: "page-2" };
    return { ok: true, status: 200, json: async () => body };
  };
  const input = { token: "fake", disabled: false, text, pageId: "p1", fetch, workspaceId: "A", operationStore: memoryStore().store };
  const held = await runNotionTurn({ ...input, confirmed: false });
  const result = await runNotionTurn({ ...input, confirmed: true, operationId: held.operationId });
  assert.equal(result.wrote, true);
  assert.equal(result.verified, false);
  const retry = await runNotionTurn({ ...input, confirmed: false, operationId: held.operationId });
  assert.equal(retry.verified, false);
  assert.equal(writes, 1);
});

test("long multiline approval writes the complete reviewed content and checks its full readback", async () => {
  const note = "Keep this introduction.\n" + "😀".repeat(2600) + "\nInclude the ending.";
  const spans: string[] = [];
  let writes = 0;
  const fetch = async (url: string, init?: RequestInit) => {
    let body: unknown = page;
    if (init?.method === "PATCH") {
      writes++;
      const paragraph = JSON.parse(String(init.body)).children[0].paragraph;
      for (const part of paragraph.rich_text) spans.push(part.text.content);
      body = { results: [{ id: "long-block" }] };
    } else if (url.endsWith("/blocks/long-block")) {
      body = { ...block("", "long-block"), paragraph: { rich_text: spans.map((plain_text) => ({ plain_text })) } };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  const input = { token: "fixture", disabled: false, text: `Append ${note} to the Notion page about roadmap`, pageId: "p1", operationStore: memoryStore().store, workspaceId: "A", fetch };
  const held = await runNotionTurn({ ...input, confirmed: false });
  const result = await runNotionTurn({ ...input, operationId: held.operationId, confirmed: true });
  assert.equal(result.verified, true);
  assert.equal(spans.join(""), note);
  assert.ok(spans.every((part) => part.length <= 2000));
  const tooLong = await runNotionTurn({ ...input, text: input.text + "x".repeat(8000), confirmed: true });
  assert.equal(tooLong.ok, false);
  assert.equal(writes, 1);
});
