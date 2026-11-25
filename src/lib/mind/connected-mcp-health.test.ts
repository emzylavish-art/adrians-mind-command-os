import assert from "node:assert/strict";
import { test } from "node:test";
import { dbSource, getSql } from "../db.ts";
import { listConnectedMcp, runConnectedMcpTurn, saveConnectedMcp } from "./connected-mcp.server.ts";

test("paged discovery, exact preflight and rejected credential health use the same durable connection", async () => {
  assert.equal(dbSource, "pglite");
  process.env.CONNECTOR_TOKEN_SECRET = "synthetic-connection-health";
  const db = await getSql();
  const pages: string[] = [];
  const calls: string[] = [];
  let reject = false;
  const deps = { isHalted: () => false, fetch: async (_url: string, init?: RequestInit) => {
    const msg = JSON.parse(String(init?.body));
    const cursor = msg.params?.cursor;
    if (msg.method === "tools/list") pages.push(cursor || "first");
    if (msg.method === "tools/call") calls.push(msg.params.arguments.query);
    const data = msg.method === "tools/list" ? {
      ...(cursor ? {} : { nextCursor: "second" }),
      tools: [{ name: cursor ? "search" : "lookup", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
    } : msg.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: {} } : { content: [{ type: "text", text: "result" }] };
    return { ok: !reject, status: reject ? 401 : 200, headers: new Headers(), text: async () => JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: data }) };
  } };
  const saved = await saveConnectedMcp(db, "fixture-owner", { label: "My server", url: "http://localhost/mcp", token: "synthetic-fixture" }, deps);
  assert.ok(saved.ok);
  assert.deepEqual(pages, ["first", "second"]);
  let approvalId: string | undefined;
  const turn = (query: string, confirmed = false) => runConnectedMcpTurn({ db, userId: "fixture-owner", text: `call MCP tool search on server ${saved.savedId} ${JSON.stringify({ query })}`, confirmed, approvalId, approvalServerId: confirmed ? saved.savedId : undefined, ...deps });
  assert.equal((await turn("x".repeat(501))).needsConfirmation, false);
  assert.equal(calls.length, 0);
  approvalId = (await turn("notes")).approvalId;
  assert.ok(approvalId);
  assert.equal((await turn("different", true)).ok, false);
  reject = true;
  assert.equal((await turn("notes", true)).ok, false);
  assert.equal((await listConnectedMcp(db, "fixture-owner"))[0].state, "failed");
  assert.match((await listConnectedMcp(db, "fixture-owner"))[0].error, /401/);
  assert.equal(calls.length, 0);
  reject = false;
  approvalId = (await turn("notes")).approvalId;
  assert.ok((await turn("notes", true)).ok);
  assert.equal((await listConnectedMcp(db, "fixture-owner"))[0].state, "connected");
  assert.deepEqual(calls, ["notes"]);
});
