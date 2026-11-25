import assert from "node:assert/strict";
import test from "node:test";
import { notionSearchIssue, retainActivity } from "./connection-attention.ts";

test("routine actions cannot clear Notion search attention; successful search and explicit disconnect can", () => {
  const issue = { id: "failure", at: "", action: "network_failure", target: "notion:search", result: "Connection failed" };
  let rows = [issue];
  for (let n = 0; n < 220; n++) rows = retainActivity([{ ...issue, id: String(n), action: "create_chat", target: "chat" }, ...rows]);
  assert.equal(rows.length, 200);
  assert.equal(notionSearchIssue(rows), issue);
  for (const action of ["notion_search_recovered", "notion_search_disconnected"]) assert.equal(notionSearchIssue([{ ...issue, action }, ...rows]), null);
  assert.equal(notionSearchIssue([{ ...issue, action: "notion_search_recovered", target: "another-service" }, ...rows]), issue);
});
