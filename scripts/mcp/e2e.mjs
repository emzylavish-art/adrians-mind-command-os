#!/usr/bin/env node
/**
 * End-to-end MCP check:
 * 1) Real PGLite SELECT 1 via pglite_query
 * 2) Registry callTool for the same
 * 3) Built-in MCP HTTP (SDK) tools/call for pglite_query
 * Writes /workspace/audit/mcp-integration/e2e.log
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const AUDIT = "/workspace/audit/mcp-integration";
mkdirSync(AUDIT, { recursive: true });
const lines = [];
function log(line) {
  const row = `[${new Date().toISOString()}] ${line}`;
  lines.push(row);
  console.log(row);
}

const root = process.cwd();

async function main() {
  log(`cwd=${root}`);
  const pg = new PGlite();
  const sqlClient = {
    query: async (text, params = []) => {
      const result = await pg.query(text, params);
      return result.rows;
    },
  };

  const { pgliteQuery } = await import(pathToFileURL(join(root, "src/lib/mind/mcp/tools.ts")).href);
  const direct = await pgliteQuery({ sql: "SELECT 1 AS n", sqlClient });
  log(`direct pglite_query ok=${direct.ok} status=${direct.status}`);
  log(`direct output: ${direct.text.replace(/\n/g, " ")}`);

  const registry = await import(pathToFileURL(join(root, "src/lib/mind/mcp/registry.ts")).href);
  registry.setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-e2e-")));
  log(`registry servers: ${JSON.stringify(registry.listRegistryServers("e2e-user"))}`);
  const reg = await registry.callRegistryTool({
    userId: "e2e-user",
    serverId: registry.BUILTIN_ID,
    tool: "pglite_query",
    args: { sql: "SELECT 1 AS n" },
    getSql: async () => sqlClient,
  });
  log(`registry call ok=${reg.ok} status=${reg.status}`);
  log(`registry output: ${reg.text.replace(/\n/g, " ")}`);

  const { handleBuiltinMcpHttp } = await import(pathToFileURL(join(root, "src/lib/mind/mcp/builtin-server.ts")).href);

  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const url = `http://127.0.0.1${req.url}`;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const response = await handleBuiltinMcpHttp(request, { getSql: async () => sqlClient, authenticate: async () => "e2e-user" });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = 500;
      res.end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  log(`MCP HTTP listening on ${mcpUrl}`);

  async function rpc(message, session) {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(session ? { "mcp-session-id": session } : {}),
      },
      body: JSON.stringify(message),
    });
    const text = await response.text();
    const nextSession = response.headers.get("mcp-session-id");
    log(`rpc ${message.method || "notification"} status=${response.status} body=${text.slice(0, 600)}`);
    return { response, text, session: nextSession };
  }

  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
  });
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, init.session);
  await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.session);
  const called = await rpc(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "pglite_query", arguments: { sql: "SELECT 1 AS n" } },
    },
    init.session,
  );
  log(`tools/call final: ${called.text.slice(0, 800)}`);

  const notion = await registry.callRegistryTool({
    userId: "e2e-user",
    serverId: registry.BUILTIN_ID,
    tool: "notion_read_page",
    args: { page_id: "40b1aa27632381768d58cde0731f142a" },
    getSql: async () => sqlClient,
  });
  log(`notion_read_page: ${notion.text}`);
  const pc = await registry.callRegistryTool({
    userId: "e2e-user",
    serverId: registry.BUILTIN_ID,
    tool: "pc_run_shell",
    args: { command: "pwd", confirm: true },
    getSql: async () => sqlClient,
  });
  log(`pc_run_shell: ${pc.text}`);

  server.close();
  await pg.close?.();
  writeFileSync(join(AUDIT, "e2e.log"), lines.join("\n") + "\n");
  log(`wrote ${join(AUDIT, "e2e.log")}`);
  if (!direct.ok || !reg.ok || !/SELECT 1|"n"\s*:\s*1|rowCount/i.test(called.text)) {
    // MCP call body should mention the result somehow
    if (!direct.ok || !reg.ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  writeFileSync(join(AUDIT, "e2e.log"), lines.concat([String(error?.stack || error)]).join("\n") + "\n");
  process.exit(1);
});
