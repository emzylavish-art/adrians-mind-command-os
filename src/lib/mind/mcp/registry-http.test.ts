import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  BUILTIN_ID,
  callRegistryTool,
  isPrivateAddressLiteral,
  listRegistryTools,
  registerExternalServer,
  setMcpRegistryDirectory,
} from "./registry.ts";

const noSql = async () => ({ query: async () => [] });
const servers: Server[] = [];
after(() => {
  for (const s of servers) {
    s.closeAllConnections?.();
    s.close();
  }
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)),
  );
}

function rpcReply(id: unknown, result: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

async function freshOwner(url: string, owner = "owner") {
  setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-http-")));
  const saved = await registerExternalServer(owner, { label: "Remote", url });
  assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
  if (!saved.ok) throw new Error("register failed");
  return saved.servers.find((s) => s.kind === "http")!;
}

describe("http MCP registry hardening (REGRESSION)", () => {
  it("refuses private, link-local, metadata and credentialed URLs at registration", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-http-")));
    for (const url of [
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/mcp",
      "https://192.168.1.1/mcp",
      "https://172.20.0.1/mcp",
      "https://100.64.0.1/mcp",
      "https://0.0.0.0/mcp",
      "https://[fd00::1]/mcp",
      "https://[fe80::1]/mcp",
      "https://[::ffff:a9fe:a9fe]/mcp",
      "https://[::ffff:10.0.0.1]/mcp",
      "https://user:pass@mcp.example/mcp",
      "http://mcp.example/mcp",
    ]) {
      const saved = await registerExternalServer("owner", { label: "x", url });
      assert.equal(saved.ok, false, `should refuse ${url}`);
    }
    assert.equal((await registerExternalServer("owner", { label: "ok", url: "https://mcp.example/mcp" })).ok, true);
    assert.equal((await registerExternalServer("owner", { label: "local", url: "http://localhost:9/mcp" })).ok, true);
    assert.equal(isPrivateAddressLiteral("8.8.8.8"), false);
    assert.equal(isPrivateAddressLiteral("mcp.example"), false);
  });

  it("re-checks legacy stored internal URLs at call time and never fetches them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-mcp-http-"));
    setMcpRegistryDirectory(dir);
    const file = join(dir, `${createHash("sha256").update("legacy").digest("hex")}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        servers: [
          { id: BUILTIN_ID, label: "Mind built-in", kind: "builtin", enabled: true },
          { id: "old", label: "Old", kind: "http", enabled: true, url: "https://169.254.169.254/x" },
        ],
      }),
    );
    let fetched = 0;
    const spy = (async () => {
      fetched += 1;
      throw new Error("should not fetch");
    }) as never;
    const called = await callRegistryTool({ userId: "legacy", serverId: "old", tool: "t", getSql: noSql, fetch: spy });
    assert.equal(called.ok, false);
    assert.match(called.text, /refused/i);
    const tools = await listRegistryTools("legacy", spy);
    assert.equal(tools.find((t) => t.serverId === "old")?.status, "error");
    assert.equal(fetched, 0);
  });

  it("times out a hung server instead of hanging the Tools list or call", async () => {
    const url = await listen(() => {
      /* never answer */
    });
    const server = await freshOwner(url);
    const started = Date.now();
    const tools = await listRegistryTools("owner", undefined, { http: { timeoutMs: 300 } });
    const row = tools.find((t) => t.serverId === server.id);
    assert.equal(row?.status, "timeout");
    assert.equal(row?.name, "(timeout)");
    assert.equal(tools.some((t) => t.name === "pglite_query"), true);
    const called = await callRegistryTool({ userId: "owner", serverId: server.id, tool: "x", getSql: noSql, http: { timeoutMs: 300 } });
    assert.equal(called.status, "timeout");
    assert.equal(called.ok, false);
    assert.ok(Date.now() - started < 5000);
  });

  it("does not follow redirects (no blind SSRF, no token forwarding)", async () => {
    let internalHits = 0;
    const internal = await listen((_req, res) => {
      internalHits += 1;
      res.end(rpcReply(1, {}));
    });
    const url = await listen((_req, res) => {
      res.writeHead(307, { location: internal });
      res.end();
    });
    const server = await freshOwner(url);
    const called = await callRegistryTool({ userId: "owner", serverId: server.id, tool: "x", getSql: noSql });
    assert.equal(called.ok, false);
    assert.match(called.text, /redirect/i);
    assert.equal(internalHits, 0);
  });

  it("drops oversized responses instead of buffering them", async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = "x".repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 200) {
          sent += 1;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      pump();
    });
    const server = await freshOwner(url);
    const called = await callRegistryTool({ userId: "owner", serverId: server.id, tool: "x", getSql: noSql, http: { maxBytes: 100_000 } });
    assert.equal(called.ok, false);
    assert.match(called.text, /larger than 100000 bytes/);
  });

  it("still lists and calls a well-behaved local MCP server", async () => {
    const url = await listen((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const msg = JSON.parse(raw) as { id?: number; method: string };
        res.setHeader("mcp-session-id", "s1");
        if (msg.method === "initialize") return res.end(rpcReply(msg.id, { protocolVersion: "2024-11-05", capabilities: {} }));
        if (msg.method === "tools/list") return res.end(rpcReply(msg.id, { tools: [{ name: "ping", description: "p" }] }));
        if (msg.method === "tools/call") return res.end(rpcReply(msg.id, { content: [{ type: "text", text: "pong" }] }));
        res.statusCode = 202;
        res.end();
      });
    });
    const server = await freshOwner(url);
    const tools = await listRegistryTools("owner");
    assert.equal(tools.some((t) => t.serverId === server.id && t.name === "ping"), true);
    const called = await callRegistryTool({ userId: "owner", serverId: server.id, tool: "ping", getSql: noSql });
    assert.equal(called.ok, true);
    assert.equal(called.text, "pong");
  });
});
