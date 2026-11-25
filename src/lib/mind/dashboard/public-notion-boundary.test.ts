import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardStatus } from "./status.ts";

test("public dashboard excludes Notion before constructing derived feeds", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected provider call"); };
  try {
    const status = await buildDashboardStatus({ NOTION_TOKEN: "fixture-only" });
    assert.equal(requests, 0);
    assert.equal(status.notion.available, false);
    assert.equal(status.notionGraph.available, false);
    assert.deepEqual(status.notionGraph.pages, []);
    assert.deepEqual(status.notionGraph.edges, []);
    assert.deepEqual(status.notionGraph.botPageMap, {});
  } finally { globalThis.fetch = original; }
});
