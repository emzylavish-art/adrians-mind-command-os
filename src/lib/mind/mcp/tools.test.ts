import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertReadOnlySql,
  isShellAllowlisted,
  notionAppendSection,
  notionReadPage,
  parseNotionPageId,
  pcRunShell,
  pgliteQuery,
} from "./tools.ts";

describe("mcp tools", () => {
  it("parses Notion page ids from bare ids and URLs", () => {
    assert.equal(parseNotionPageId("40b1aa27632381768d58cde0731f142a"), "40b1aa27-6323-8176-8d58-cde0731f142a");
    assert.equal(
      parseNotionPageId("https://www.notion.so/workspace/40b1aa27632381768d58cde0731f142a"),
      "40b1aa27-6323-8176-8d58-cde0731f142a",
    );
    assert.equal(parseNotionPageId("not-a-page"), null);
  });

  it("refuses Notion tools when the token is missing", async () => {
    const read = await notionReadPage({ pageIdOrUrl: "40b1aa27632381768d58cde0731f142a", token: "" });
    assert.equal(read.ok, false);
    assert.match(read.text, /not configured/i);
    const append = await notionAppendSection({
      pageIdOrUrl: "40b1aa27632381768d58cde0731f142a",
      heading: "H",
      markdown: "Body",
      token: "",
    });
    assert.equal(append.ok, false);
    assert.match(append.text, /not configured/i);
  });

  it("returns no paired PC when the agent URL is unset", async () => {
    const result = await pcRunShell({ command: "pwd", env: {}, confirm: true });
    assert.equal(result.ok, false);
    assert.match(result.text, /No paired PC online/);
  });

  it("ignores confirm:true for non-allowlisted shell commands even when a PC URL is set", async () => {
    const result = await pcRunShell({
      command: "rm -rf /",
      confirm: true,
      env: { MIND_PC_AGENT_URL: "http://127.0.0.1:9" },
    });
    assert.equal(result.ok, false);
    assert.match(result.text, /allowlist|Approve it in the Tools panel/i);
    assert.equal(isShellAllowlisted("pwd"), true);
  });

  it("allows only read-only SQL", () => {
    assert.equal(assertReadOnlySql("SELECT 1").ok, true);
    assert.equal(assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x").ok, true);
    assert.equal(assertReadOnlySql("DELETE FROM mind_chat").ok, false);
    assert.equal(assertReadOnlySql("DROP TABLE mind_chat").ok, false);
    assert.equal(assertReadOnlySql("SELECT 1; DELETE FROM mind_chat").ok, false);
    assert.equal(assertReadOnlySql("WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x").ok, false);
  });

  it("runs a read-only query through the sql client", async () => {
    const result = await pgliteQuery({
      sql: "SELECT 1 AS n",
      sqlClient: {
        query: async () => [{ n: 1 }],
      },
    });
    assert.equal(result.ok, true);
    assert.match(result.text, /"n": 1/);
  });

  it("surfaces SQL errors honestly", async () => {
    const result = await pgliteQuery({
      sql: "SELECT * FROM definitely_missing",
      sqlClient: {
        query: async () => {
          throw new Error('relation "definitely_missing" does not exist');
        },
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.text, /does not exist/);
  });
});
