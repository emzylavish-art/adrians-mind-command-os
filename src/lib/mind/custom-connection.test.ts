import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { callCustomConnection, listCustomConnections, saveCustomConnection, type ConnectionDb } from "./custom-connection.ts";
import { toMcpCallContract } from "./mcp/call-contract.ts";

function memoryDb(): ConnectionDb & { rows: { user_id: string; id: string; record: string }[] } {
  const rows: { user_id: string; id: string; record: string }[] = [];
  return {
    rows,
    async query(text, params = []) {
      if (text.includes("select")) {
        return rows.filter((row) => row.user_id === params[0]).map((row) => ({ record: JSON.parse(row.record) }));
      }
      if (text.includes("insert")) {
        const [user_id, id, record] = params as [string, string, string];
        const index = rows.findIndex((row) => row.user_id === user_id && row.id === id);
        const next = { user_id, id, record: typeof record === "string" ? record : JSON.stringify(record) };
        if (index >= 0) rows[index] = next;
        else rows.push(next);
      }
      return [];
    },
  };
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("custom connections", () => {
  it("saves, reloads, lists schema, and calls a local mock read", async () => {
    const db = memoryDb();
    const seen: string[] = [];
    const { server, url } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const message = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { id?: number; method?: string; params?: { arguments?: { id?: string; text?: string } } };
        seen.push(message.method ?? req.method ?? "");
        if (req.headers.authorization !== "Bearer stored-token") {
          res.writeHead(401);
          res.end("");
          return;
        }
        if (message.method === "tools/call" && message.params?.arguments && "text" in message.params.arguments) {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "generic text" }] } }));
          return;
        }
        const body = message.method === "tools/list"
          ? { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "status", description: "Read status", inputSchema: { type: "object", properties: { id: { type: "string", description: "row" } }, required: ["id"] } }] } }
          : message.method === "tools/call"
            ? { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: `status:${message.params?.arguments?.id}` }] } }
            : { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05" } };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      });
    });
    try {
      const saved = await saveCustomConnection(db, "owner-a", { label: "Desk", kind: "mcp", url: `${url}/mcp`, auth: "bearer", token: "stored-token" });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      assert.equal(saved.connection.state, "ready");
      assert.equal(saved.connection.hasToken, true);
      assert.equal(JSON.stringify(saved.connection).includes("stored-token"), false);
      const reloaded = await listCustomConnections(db, "owner-a");
      assert.equal(reloaded[0]?.operations[0]?.name, "status");
      assert.equal(reloaded[0]?.operations[0]?.inputSchema?.required[0], "id");
      assert.equal((await listCustomConnections(db, "owner-b")).length, 0);
      const denied = await callCustomConnection({ db, userId: "owner-a", id: saved.connection.id, operation: "status", args: { text: "nope" }, confirmed: true });
      assert.equal(denied.status, "incompatible");
      assert.equal(seen.includes("tools/call"), false);
      const called = await callCustomConnection({ db, userId: "owner-a", id: saved.connection.id, operation: "status", args: { id: "7" }, confirmed: true });
      assert.equal(called.status, "ok");
      assert.equal(called.text, "status:7");
      assert.equal(called.text.includes("stored-token"), false);
    } finally {
      server.close();
    }
  });

  it("reports unauthorized, missing config, and blocks metadata hosts", async () => {
    const db = memoryDb();
    const blocked = await saveCustomConnection(db, "owner", { label: "meta", kind: "http", url: "https://169.254.169.254/latest", method: "GET" });
    assert.equal(blocked.ok, false);
    const { server, url } = await listen((_req, res) => {
      res.writeHead(401);
      res.end("");
    });
    try {
      const saved = await saveCustomConnection(db, "owner", { label: "locked", kind: "http", url: `${url}/status`, method: "GET", auth: "bearer", token: "secret-token", fields: [] });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      const called = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "request", args: {} });
      assert.equal(called.status, "unauthorized");
      assert.equal(called.text.includes("secret-token"), false);
    } finally {
      server.close();
    }
  });
});

describe("mcp call contract", () => {
  it("keeps ok/text and adds transport plus rpc without pretending success", () => {
    const body = toMcpCallContract({ ok: false, status: "error", serverId: "s", tool: "status", text: "The MCP server returned 401. Nothing was called.", ms: 12 });
    assert.equal(body.ok, false);
    assert.equal(body.text.includes("401"), true);
    assert.equal(body.code, "unauthorized");
    assert.equal(body.transport.status, 401);
    assert.equal(body.transport.ms, 12);
    assert.equal(body.rpc.isError, true);
    assert.equal(body.rpc.content[0]?.text, body.text);
  });
});
