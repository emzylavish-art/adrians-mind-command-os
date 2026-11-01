/**
 * Regression: /api/mind/mcp/builtin used to answer MCP JSON-RPC with NO
 * authentication, so anyone who could reach the app could run pglite_query
 * against the app database, read/append Notion pages with the server token,
 * and queue pc_run_shell. These tests pin the fail-closed behaviour.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { handleBuiltinMcpHttp } from "./builtin-server.ts";
import type { SqlLike } from "./tools.ts";

const ACCEPT = "application/json, text/event-stream";

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1/api/mind/mcp/builtin", {
    method: "POST",
    headers: { "content-type": "application/json", accept: ACCEPT, ...headers },
    body: JSON.stringify(body),
  });
}

const callSelect = {
  jsonrpc: "2.0",
  id: 7,
  method: "tools/call",
  params: { name: "pglite_query", arguments: { sql: "SELECT secret FROM users" } },
};

function spySql() {
  const calls: string[] = [];
  const sql: SqlLike = {
    query: async (text: string) => {
      calls.push(text);
      return [{ secret: "leaked" }];
    },
  };
  return { calls, getSql: async () => sql };
}

describe("builtin MCP HTTP endpoint auth", () => {
  it("refuses an anonymous tools/call with 401 and never touches the database", async () => {
    const spy = spySql();
    const response = await handleBuiltinMcpHttp(rpc(callSelect), {
      getSql: spy.getSql,
      authenticate: async () => null,
    });
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.doesNotMatch(text, /leaked/);
    const body = JSON.parse(text) as { error?: { message?: string }; id?: unknown };
    assert.match(body.error?.message ?? "", /sign in/i);
    assert.equal(spy.calls.length, 0);
  });

  it("refuses when the authenticator throws (expired/forged session)", async () => {
    const spy = spySql();
    const response = await handleBuiltinMcpHttp(rpc(callSelect, { authorization: "Bearer forged" }), {
      getSql: spy.getSql,
      authenticate: async () => {
        throw new Error("Unauthorized");
      },
    });
    assert.equal(response.status, 401);
    assert.equal(spy.calls.length, 0);
  });

  it("fails closed for the legacy (request, getSql) call shape with no authenticator", async () => {
    const spy = spySql();
    const legacy = handleBuiltinMcpHttp as unknown as (r: Request, g: () => Promise<SqlLike>) => Promise<Response>;
    const response = await legacy(rpc(callSelect), spy.getSql);
    assert.equal(response.status, 401);
    assert.equal(spy.calls.length, 0);
  });

  it("refuses anonymous initialize and tools/list too (no tool surface disclosure)", async () => {
    for (const method of ["initialize", "tools/list"]) {
      const response = await handleBuiltinMcpHttp(
        rpc({ jsonrpc: "2.0", id: 1, method, params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } } }),
        { authenticate: async () => null },
      );
      assert.equal(response.status, 401, method);
      assert.doesNotMatch(await response.text(), /pglite_query/);
    }
  });

  it("refuses when emergency stop is on for the signed-in owner", async () => {
    const spy = spySql();
    const response = await handleBuiltinMcpHttp(rpc(callSelect), {
      getSql: spy.getSql,
      authenticate: async () => "owner-1",
      isHalted: async (id) => id === "owner-1",
    });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /emergency stop/i);
    assert.equal(spy.calls.length, 0);
  });

  it("still serves a signed-in caller", async () => {
    const spy = spySql();
    const response = await handleBuiltinMcpHttp(rpc(callSelect), {
      getSql: spy.getSql,
      authenticate: async () => "owner-1",
      isHalted: async () => false,
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { result?: { content?: { text?: string }[]; isError?: boolean } };
    assert.equal(body.result?.isError, false);
    assert.match(body.result?.content?.[0]?.text ?? "", /leaked/);
    assert.equal(spy.calls.length >= 1, true);
  });

  it("the /api/mind/mcp/builtin route wires session auth and halt into the handler", () => {
    const source = readFileSync(join(import.meta.dirname, "../../../routes/api/mind/mcp/builtin.ts"), "utf8");
    assert.match(source, /requireUserId/);
    assert.match(source, /authenticate\s*:/);
    assert.match(source, /isHalted\s*:/);
  });
});
