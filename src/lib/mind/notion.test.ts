import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Sql } from "../db.ts";
import { readToolRuns, writeToolRun } from "./notion-record.ts";
import { NOTION_SETUP, notionConnection, pagesFromSearch, parseNotionIntent, probeNotionConnection, readNotionPref, runNotionTurn, setNotionPrefDirectory, textFromBlocks, writeNotionPref } from "./notion.ts";

const page = (id: string, title: string) => ({
  object: "page",
  id,
  url: `https://www.notion.so/${id}`,
  properties: { Name: { type: "title", title: [{ plain_text: title }] } },
});

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const key = `${init?.method ?? "GET"} ${url.replace("https://api.notion.com/v1", "")}`;
    const hit = routes[key] ?? { status: 404, body: { message: "missing" } };
    return { ok: (hit.status ?? 200) < 400, status: hit.status ?? 200, json: async () => hit.body };
  };
  return { fetch, calls };
}

describe("notion", () => {
  it("names search, read, and append without calling the network", () => {
    assert.equal(parseNotionIntent("Search my Notion workspace for the project roadmap").action, "search");
    assert.equal(parseNotionIntent("Read the Notion page about Adrian’s operating system").action, "read");
    const append = parseNotionIntent("Append today's priorities to the Notion page about the roadmap");
    assert.equal(append.action, "append");
    if (append.action === "append") assert.match(append.note, /today/);
    assert.equal(parseNotionIntent("What is a pier?").action, "unclear");
  });

  it("keeps only real page and database results", () => {
    const pages = pagesFromSearch({
      results: [page("abc", "Roadmap"), { object: "database", id: "db1", url: "https://www.notion.so/db1", title: [{ plain_text: "Tasks" }] }, { object: "user", id: "u" }, { object: "page", id: "no-url" }],
    });
    assert.deepEqual(pages.map((item) => item.title), ["Roadmap", "Tasks"]);
    assert.equal(pagesFromSearch({ results: [] }).length, 0);
  });

  it("reads block text and ignores blocks with none", () => {
    const text = textFromBlocks({ results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Pier plan" }] } }, { type: "image", image: {} }] });
    assert.equal(text, "Pier plan");
  });

  it("does not call Notion when the token is missing or the owner disconnected", async () => {
    const { fetch, calls } = fakeFetch({});
    const missing = await runNotionTurn({ token: "", disabled: false, text: "Search Notion for roadmap", confirmed: false, pageId: null, fetch });
    assert.equal(missing.state, "unconfigured");
    assert.equal(missing.error, NOTION_SETUP);
    const off = await runNotionTurn({ token: "secret-token", disabled: true, text: "Search Notion for roadmap", confirmed: false, pageId: null, fetch });
    assert.equal(off.state, "disconnected");
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify([missing, off]).includes("secret-token"), false);
  });

  it("returns the pages Notion returned and does not invent a miss", async () => {
    const { fetch } = fakeFetch({
      "POST /search": { body: { results: [page("p1", "Roadmap"), page("p2", "Other")] } },
    });
    const result = await runNotionTurn({ token: "secret", disabled: false, text: "Search my Notion for roadmap", confirmed: false, pageId: null, fetch });
    assert.equal(result.ok, true);
    assert.deepEqual(result.pages.map((item) => item.title), ["Roadmap", "Other"]);
    const empty = await runNotionTurn({
      token: "secret",
      disabled: false,
      text: "Search my Notion for missing",
      confirmed: false,
      pageId: null,
      fetch: fakeFetch({ "POST /search": { body: { results: [] } } }).fetch,
    });
    assert.match(empty.error, /no matching pages/);
  });

  it("asks which page when a read matches more than one and does not write", async () => {
    const { fetch, calls } = fakeFetch({ "POST /search": { body: { results: [page("p1", "Roadmap"), page("p2", "Other")] } } });
    const result = await runNotionTurn({ token: "secret", disabled: false, text: "Read the Notion page about roadmap", confirmed: true, pageId: null, fetch });
    assert.equal(result.ambiguous, true);
    assert.equal(result.wrote, false);
    assert.equal(calls.some((call) => call.includes("PATCH")), false);
  });

  it("reads the selected page content", async () => {
    const { fetch } = fakeFetch({
      "POST /search": { body: { results: [page("p1", "Roadmap")] } },
      "GET /blocks/p1/children?page_size=20": { body: { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "Actual plan" }] } }] } },
    });
    const result = await runNotionTurn({ token: "secret", disabled: false, text: "Read the Notion page about roadmap", confirmed: false, pageId: null, fetch });
    assert.equal(result.content, "Actual plan");
    assert.equal(result.wrote, false);
  });

  it("requires confirmation before an append and then verifies the text is on the page", async () => {
    const routes = {
      "POST /search": { body: { results: [page("p1", "Roadmap")] } },
      "PATCH /blocks/p1/children": { body: { results: [] } },
      "GET /blocks/p1/children?page_size=50": { body: { results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "today's priorities" }] } }] } },
    };
    const held = await runNotionTurn({ token: "secret", disabled: false, text: "Append today's priorities to the Notion page about roadmap", confirmed: false, pageId: null, fetch: fakeFetch(routes).fetch });
    assert.equal(held.needsConfirmation, true);
    assert.equal(held.wrote, false);
    const done = await runNotionTurn({ token: "secret", disabled: false, text: "Append today's priorities to the Notion page about roadmap", confirmed: true, pageId: "p1", fetch: fakeFetch(routes).fetch });
    assert.equal(done.verified, true);
    assert.equal(done.wrote, true);
  });

  it("does not call a write successful when the read-back misses the text", async () => {
    const result = await runNotionTurn({
      token: "secret",
      disabled: false,
      text: "Append today's priorities to the Notion page about roadmap",
      confirmed: true,
      pageId: "p1",
      fetch: fakeFetch({
        "POST /search": { body: { results: [page("p1", "Roadmap")] } },
        "PATCH /blocks/p1/children": { body: { results: [] } },
        "GET /blocks/p1/children?page_size=50": { body: { results: [] } },
      }).fetch,
    });
    assert.equal(result.ok, false);
    assert.equal(result.verified, false);
    assert.match(result.error, /not found/);
  });

  it("reports an API error and does not invent pages", async () => {
    const result = await runNotionTurn({
      token: "secret-token",
      disabled: false,
      text: "Search Notion for roadmap",
      confirmed: false,
      pageId: null,
      fetch: fakeFetch({ "POST /search": { status: 401, body: { message: "API token is invalid." } } }).fetch,
    });
    assert.equal(result.ok, false);
    assert.equal(result.pages.length, 0);
    assert.match(result.error, /invalid/);
    assert.equal(result.error.includes("secret-token"), false);
  });

  it("keeps one owner's disconnect off another owner", () => {
    setNotionPrefDirectory(mkdtempSync(join(tmpdir(), "mind-notion-")));
    writeNotionPref("owner-a", true);
    assert.equal(readNotionPref("owner-a").disabled, true);
    assert.equal(readNotionPref("owner-b").disabled, false);
    assert.equal(notionConnection("secret", true).state, "disconnected");
  });

  it("stores a tool run for one owner only", async () => {
    const tables = new Map<string, Map<string, { user_id: string; id: string }>>();
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      const table = "mind_tool_run";
      if (!tables.has(table)) tables.set(table, new Map());
      if (text.startsWith("insert")) {
        tables.get(table)?.set(`${values[0]}:${values[1]}`, { user_id: String(values[0]), id: String(values[1]) });
        return [];
      }
      return [...(tables.get(table)?.values() ?? [])].filter((row) => row.user_id === values[0]);
    }) as Sql;
    sql.query = async () => [];
    await writeToolRun(sql, "owner-a", { id: "r1", tool: "notion", action: "search", ok: true, detail: "2 pages" });
    await writeToolRun(sql, "owner-b", { id: "r2", tool: "notion", action: "search", ok: false, detail: "not connected" });
    const a = await readToolRuns(sql, "owner-a");
    const b = await readToolRuns(sql, "owner-b");
    assert.deepEqual(a.map((row) => row.id), ["r1"]);
    assert.deepEqual(b.map((row) => row.id), ["r2"]);
  });
});


describe("probeNotionConnection", () => {
  it("stays unconfigured when token missing", async () => {
    const status = await probeNotionConnection({
      token: undefined,
      disabled: false,
      fetch: async () => {
        throw new Error("should not call");
      },
    });
    assert.equal(status.state, "unconfigured");
    assert.match(status.detail, /NOTION_TOKEN/);
  });

  it("does not report connected when users\/me fails", async () => {
    const status = await probeNotionConnection({
      token: "secret",
      disabled: false,
      fetch: async () => ({ ok: false, status: 401, json: async () => ({ message: "unauthorized" }) }),
    });
    assert.equal(status.state, "unconfigured");
    assert.match(status.detail, /rejected|unauthorized|API/i);
  });

  it("reports connected only after users\/me succeeds", async () => {
    const status = await probeNotionConnection({
      token: "secret",
      disabled: false,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ id: "user", object: "user" }) }),
    });
    assert.equal(status.state, "connected");
    assert.match(status.detail, /users\/me|answered/i);
  });
});
