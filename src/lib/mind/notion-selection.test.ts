import assert from "node:assert/strict";
import { test } from "node:test";
import { runNotionTurn } from "./notion.ts";

const page = (id: string) => ({ object: "page", id, url: `https://notion.so/${id}`, properties: { title: { title: [{ plain_text: "Roadmap" }] } } });
test("selection beyond first search page reads the exact page with the current grant", async () => {
  const calls: string[] = [];
  const result = await runNotionTurn({ token: "synthetic", disabled: false, text: "Read Notion page Roadmap", confirmed: false, pageId: "p99", fetch: async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => url.endsWith("/pages/p99") ? page("p99") : { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Chosen page" }] } }] } };
  } });
  assert.equal(result.ok, true); assert.equal(result.content, "Chosen page"); assert.equal(calls.some((url) => url.endsWith("/search")), false);
});

test("denied selected page never falls back to another accessible page", async () => {
  let calls = 0;
  const result = await runNotionTurn({ token: "synthetic", disabled: false, text: "Append note to Notion page Roadmap", confirmed: true, pageId: "denied", fetch: async () => { calls++; return { ok: false, status: 403, json: async () => ({ message: "Page access revoked" }) }; } });
  assert.equal(result.ok, false); assert.equal(result.wrote, false); assert.equal(calls, 1);
});

test("partial search results keep selection unresolved and expose the next cursor", async () => {
  const result = await runNotionTurn({ token: "synthetic", disabled: false, text: "Read Notion page Roadmap", confirmed: false, pageId: null, fetch: async () => ({ ok: true, status: 200, json: async () => ({ results: [page("p1")], has_more: true, next_cursor: "next" }) }) });
  assert.equal(result.ambiguous, true); assert.equal(result.nextCursor, "next"); assert.equal(result.needsConfirmation, false);
});
