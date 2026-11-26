import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { callCustomConnection, listCustomConnections, saveCustomConnection } from "./custom-connection.ts";
import { privacyErrorText, toMcpCallContract } from "./mcp/call-contract.ts";
import { callRegistryTool, listRegistryServers } from "./mcp/registry.ts";
import { decryptSecret } from "./connectors/crypto.ts";
import { readLegacyRegistryFile, resetRegistryStoreForTests, setMcpRegistryDirectory, toDurableRecord, type RegistryDb } from "./mcp/registry-store.ts";

const SECRET = "test-connector-secret";

type Row = { user_id: string; id: string; record: string };

function memoryDb(rows: Row[] = []): RegistryDb & { rows: Row[] } {
  return {
    rows,
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const userId = String(params[0] ?? "");
      if (text.startsWith("select record")) {
        return rows.filter((row) => row.user_id === userId).map((row) => ({ record: row.record })) as T[];
      }
      if (text.startsWith("select id")) {
        return rows.filter((row) => row.user_id === userId).map((row) => ({ id: row.id })) as T[];
      }
      if (text.startsWith("delete")) {
        const id = String(params[1] ?? "");
        const index = rows.findIndex((row) => row.user_id === userId && row.id === id);
        if (index >= 0) rows.splice(index, 1);
        return [] as T[];
      }
      if (text.startsWith("insert")) {
        const id = String(params[1] ?? "");
        const record = String(params[2] ?? "");
        const index = rows.findIndex((row) => row.user_id === userId && row.id === id);
        const next = { user_id: userId, id, record };
        if (index >= 0) rows[index] = next;
        else rows.push(next);
        return [] as T[];
      }
      return [] as T[];
    },
  };
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${address.port}/mcp` });
    });
  });
}

describe("shared durable registry", { concurrency: false }, () => {
  it("saves, reloads, lists, and reads through the same rows", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const rows: Row[] = [];
    const db = memoryDb(rows);
    const seen: string[] = [];
    const { server, url } = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const message = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
        seen.push(message.method ?? "");
        if (req.headers.authorization !== "Bearer stored-token") {
          res.writeHead(401);
          res.end("");
          return;
        }
        if (message.method === "tools/list") {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "status", description: "Read", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }] } }));
          return;
        }
        if (message.method === "tools/call") {
          const args = message.params?.arguments ?? {};
          if ("text" in args) {
            res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "generic text was sent" }] } }));
            return;
          }
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              isError: false,
              content: [{ type: "text", text: `status:${args.id}` }, { type: "image", data: "abc", mimeType: "image/png" }],
              structuredContent: { id: args.id },
            },
          }));
          return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05" } }));
      });
    });
    try {
      const saved = await saveCustomConnection(db, "owner-a", { label: "Desk", kind: "mcp", url, auth: "bearer", token: "stored-token" });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      assert.equal(JSON.stringify(rows).includes("stored-token"), false);
      const stored = JSON.parse(rows.find((row) => row.id === saved.connection.id)?.record ?? "{}") as { tokenEnc?: string; token?: string };
      assert.equal(typeof stored.tokenEnc, "string");
      assert.equal(stored.token, undefined);
      assert.equal(decryptSecret(stored.tokenEnc ?? ""), "stored-token");

      resetRegistryStoreForTests();
      const reloadedDb = memoryDb(rows);
      const listed = await listRegistryServers("owner-a", reloadedDb);
      const custom = await listCustomConnections(reloadedDb, "owner-a");
      assert.equal(listed.some((item) => item.id === saved.connection.id && item.hasToken), true);
      assert.equal(custom.find((item) => item.id === saved.connection.id)?.operations[0]?.inputSchema?.required[0], "id");
      assert.equal(JSON.stringify(listed).includes("stored-token"), false);
      assert.equal((await listCustomConnections(reloadedDb, "owner-b")).length, 0);

      const denied = await callCustomConnection({ db: reloadedDb, userId: "owner-a", id: saved.connection.id, operation: "status", args: { text: "nope" }, confirmed: true });
      assert.equal(denied.status, "incompatible");
      assert.equal(seen.includes("tools/call"), false);

      const called = await callRegistryTool({
        userId: "owner-a",
        serverId: saved.connection.id,
        tool: "status",
        args: { id: "7" },
        registryDb: reloadedDb,
        getSql: async () => ({ query: async () => [] }),
      });
      assert.equal(called.ok, true);
      assert.equal(called.text, "status:7");
      assert.equal(called.transport?.ok, true);
      assert.equal(called.transport?.status, 200);
      assert.equal(called.rpc?.isError, false);
      assert.equal(called.rpc?.content[1]?.type, "image");
      assert.equal(called.rpc?.content[1]?.mimeType, "image/png");
      assert.deepEqual(called.rpc?.structuredContent, { id: "7" });
      const body = toMcpCallContract({ ...called, ms: called.transport?.ms ?? 0 });
      assert.equal(body.rpc?.content[1]?.type, "image");
      assert.equal(body.text, "status:7");
    } finally {
      server.close();
      delete process.env.CONNECTOR_TOKEN_SECRET;
      resetRegistryStoreForTests();
    }
  });

  it("aborts one slow custom HTTP call and does not send it again", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const db = memoryDb();
    let calls = 0;
    const saved = await saveCustomConnection(db, "owner", { label: "Slow", kind: "http", url: "http://127.0.0.1:9/status", method: "GET" });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const called = await callCustomConnection({
      db,
      userId: "owner",
      id: saved.connection.id,
      operation: "request",
      args: {},
      timeoutMs: 40,
      fetch: (_url, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    });
    assert.equal(calls, 1);
    assert.equal(called.status, "timeout");
    assert.equal(called.text, "The server did not answer in time. Nothing was retried.");
    delete process.env.CONNECTOR_TOKEN_SECRET;
    resetRegistryStoreForTests();
  });

  it("keeps unauthorized, transport, and JSON-RPC errors distinct", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const db = memoryDb();
    const { server, url } = await listen((_req, res) => {
      res.writeHead(401);
      res.end("");
    });
    try {
      const saved = await saveCustomConnection(db, "owner", { label: "Locked", kind: "http", url, method: "GET", auth: "bearer", token: "secret-token" });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      const called = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "request", args: {} });
      assert.equal(called.status, "unauthorized");
      assert.equal(called.transport?.ok, false);
      assert.equal(called.transport?.status, 401);
      assert.equal(called.rpc, null);
      assert.equal(called.text.includes("secret-token"), false);
    } finally {
      server.close();
    }

    const { server: rpcServer, url: rpcUrl } = await listen((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: -32000, message: "bad tool" } }));
    });
    try {
      const saved = await saveCustomConnection(db, "owner", { label: "Rpc", kind: "mcp", url: rpcUrl, auth: "none" });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      const called = await callRegistryTool({
        userId: "owner",
        serverId: saved.connection.id,
        tool: "status",
        args: {},
        registryDb: db,
        getSql: async () => ({ query: async () => [] }),
      });
      assert.equal(called.ok, false);
      assert.equal(called.code, "error");
      assert.equal(called.transport?.ok, true);
      assert.equal(called.transport?.status, 200);
      assert.equal(called.rpc?.isError, true);
      assert.equal(called.rpc?.content[0]?.text, "The call failed.");
      assert.equal(called.rpc?.structuredContent, null);
    } finally {
      rpcServer.close();
      delete process.env.CONNECTOR_TOKEN_SECRET;
      resetRegistryStoreForTests();
    }
  });

  it("does not persist without the encryption secret or a database", async () => {
    resetRegistryStoreForTests();
    delete process.env.CONNECTOR_TOKEN_SECRET;
    const db = memoryDb();
    const refused = await saveCustomConnection(db, "owner", { label: "Secret", kind: "http", url: "https://mcp.example/status", method: "GET", auth: "bearer", token: "plain-token" });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "missing_config");
    assert.equal(db.rows.length, 0);
    assert.equal(JSON.stringify(db.rows).includes("plain-token"), false);

    const noDb = await saveCustomConnection(null, "owner", { label: "Nowhere", kind: "http", url: "https://mcp.example/status", method: "GET" });
    assert.equal(noDb.ok, false);
    assert.equal(readLegacyRegistryFile("owner").present, false);
    resetRegistryStoreForTests();
  });

  it("imports a legacy file without deleting it, and leaves it untouched when sealing is impossible", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mind-mcp-legacy-"));
    const userId = "legacy-owner";
    const file = join(dir, `${createHash("sha256").update(userId).digest("hex")}.json`);
    const original = JSON.stringify({
      servers: [{ id: "old", label: "Old desk", kind: "http", enabled: true, url: "https://mcp.example/mcp", token: "file-token" }],
    });
    writeFileSync(file, original);
    setMcpRegistryDirectory(dir);
    delete process.env.CONNECTOR_TOKEN_SECRET;
    const blocked = memoryDb();
    const visible = await listRegistryServers(userId, blocked);
    assert.equal(visible.some((server) => server.id === "old" && server.label === "Old desk"), true);
    assert.equal(JSON.stringify(visible).includes("file-token"), false);
    assert.equal(blocked.rows.length, 0);
    assert.equal(readFileSync(file, "utf8"), original);
    let fetched = 0;
    const called = await callRegistryTool({
      userId,
      serverId: "old",
      tool: "status",
      registryDb: blocked,
      getSql: async () => ({ query: async () => [] }),
      fetch: async () => {
        fetched += 1;
        throw new Error("should not fetch");
      },
    });
    assert.equal(called.code, "missing_config");
    assert.equal(fetched, 0);
    assert.equal(readFileSync(file, "utf8"), original);

    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const db = memoryDb();
    const imported = await listRegistryServers(userId, db);
    assert.equal(imported.some((server) => server.id === "old" && server.hasToken), true);
    assert.equal(JSON.stringify(imported).includes("file-token"), false);
    const record = JSON.parse(db.rows.find((row) => row.id === "old")?.record ?? "{}") as { token?: string; tokenEnc?: string };
    assert.equal(record.token, undefined);
    assert.equal(decryptSecret(record.tokenEnc ?? ""), "file-token");
    assert.equal(readFileSync(file, "utf8"), original);
    delete process.env.CONNECTOR_TOKEN_SECRET;
    resetRegistryStoreForTests();
  });
});

describe("durable record sealing", () => {
  it("refuses a plaintext token field", () => {
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const sealed = toDurableRecord({ id: "1", label: "A", kind: "http", enabled: true, token: "abc" });
    assert.equal(sealed.ok, true);
    if (sealed.ok) {
      assert.equal("token" in sealed.record, false);
      assert.equal(typeof sealed.record.tokenEnc, "string");
    }
    delete process.env.CONNECTOR_TOKEN_SECRET;
    const blocked = toDurableRecord({ id: "1", label: "A", kind: "http", enabled: true, token: "abc" });
    assert.equal(blocked.ok, false);
  });
});

describe("mcp call contract", () => {
  it("copies the upstream rpc result and does not invent one for a transport failure", () => {
    const upstream = toMcpCallContract({
      ok: true,
      status: "ok",
      serverId: "s",
      tool: "status",
      text: "status:7",
      ms: 4,
      code: "ok",
      transport: { ok: true, status: 200, ms: 4 },
      rpc: { isError: false, content: [{ type: "text", text: "status:7" }, { type: "image", data: "abc", mimeType: "image/png" }], structuredContent: { id: "7" } },
    });
    assert.equal(upstream.rpc?.content[1]?.type, "image");
    assert.equal(upstream.text, "status:7");
    const denied = toMcpCallContract({
      ok: false,
      status: "error",
      text: "The MCP server returned 401. Nothing was called.",
      ms: 3,
      code: "unauthorized",
      transport: { ok: false, status: 401, ms: 3 },
      rpc: null,
    });
    assert.equal(denied.rpc, null);
    assert.equal(denied.transport?.status, 401);
    assert.equal(denied.code, "unauthorized");
    assert.equal(denied.text.includes("401"), true);
    assert.equal(
      privacyErrorText("failed secret see https://mcp.example/x?k=secret Authorization: Bearer secret", "secret"),
      "failed [redacted] see [url] Authorization: [redacted] [redacted]",
    );
  });
});

describe("custom connection blueprint regressions", { concurrency: false }, () => {
  it("preserves actual 401, 403 and 500 transport status without retries", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    try {
      for (const method of ["GET", "POST"] as const) {
        for (const status of [401, 403, 500]) {
          const db = memoryDb();
          const saved = await saveCustomConnection(db, "owner", { label: "Status", kind: "http", url: "http://127.0.0.1:9/status", method });
          assert.equal(saved.ok, true);
          if (!saved.ok) continue;
          let calls = 0;
          const result = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "request", confirmed: true, fetch: async () => {
            calls += 1;
            return { ok: false, status, headers: { get: () => null }, text: async () => "private response must not be read" };
          } });
          assert.equal(calls, 1);
          assert.equal(result.transport?.status, status);
          assert.equal(result.transport?.ok, false);
          assert.equal(result.status, status === 500 ? "error" : "unauthorized");
          assert.equal(result.rpc, null);
          assert.equal(JSON.stringify(result).includes("private response"), false);
        }
      }
    } finally {
      delete process.env.CONNECTOR_TOKEN_SECRET;
      resetRegistryStoreForTests();
    }
  });

  it("drops private JSON-RPC and isError details from every custom result field", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const privateText = "fictional private narrative https://internal.example/a?token=alternate-secret Authorization: Bearer another-credential";
    try {
      for (const envelope of ["rpc-error", "tool-error"]) {
        const db = memoryDb();
        let calls = 0;
        const fetch = async (_url: string, init?: RequestInit) => {
          calls += 1;
          const request = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
          const body = request.method === "tools/list"
            ? { jsonrpc: "2.0", id: 2, result: { tools: [{ name: "status", inputSchema: { type: "object", properties: {}, required: [] } }] } }
            : request.method === "tools/call"
              ? envelope === "rpc-error"
                ? { jsonrpc: "2.0", id: 3, error: { code: -32000, message: privateText } }
                : { jsonrpc: "2.0", id: 3, result: { isError: true, content: [{ type: "text", text: privateText }], structuredContent: { token: "alternate-secret", details: privateText } } }
              : { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } };
          return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
        };
        const saved = await saveCustomConnection(db, "owner", { label: "Safe error", kind: "mcp", url: "http://127.0.0.1:9/mcp", auth: "bearer", token: "saved-token" }, { fetch });
        assert.equal(saved.ok, true);
        if (!saved.ok) continue;
        const before = calls;
        const result = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "status", confirmed: true, fetch });
        assert.equal(calls - before, 3, "one initialize, definition verification, and one call; no retry");
        assert.equal(result.ok, false);
        assert.equal(result.status, "error");
        assert.equal(result.text, "The call failed.");
        assert.equal(result.transport?.status, 200);
        assert.equal(result.rpc?.isError, true);
        assert.equal(result.rpc?.structuredContent, null);
        for (const piece of ["fictional", "internal.example", "alternate-secret", "another-credential", "saved-token"]) {
          assert.equal(JSON.stringify(result).includes(piece), false);
        }
      }
    } finally {
      delete process.env.CONNECTOR_TOKEN_SECRET;
      resetRegistryStoreForTests();
    }
  });

  it("bounds a nonsettling DNS lookup without making a network call", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    try {
      const db = memoryDb();
      const saved = await saveCustomConnection(db, "owner", { label: "DNS", kind: "http", url: "https://mcp.example/status", method: "GET" });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      let calls = 0;
      const result = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "request", timeoutMs: 20,
        lookup: async () => new Promise<never>(() => {}), fetch: async () => { calls += 1; throw new Error("No fetch expected"); } });
      assert.equal(calls, 0);
      assert.equal(result.status, "timeout");
      assert.equal(result.transport?.status, 0);
      assert.equal(result.rpc, null);
    } finally {
      delete process.env.CONNECTOR_TOKEN_SECRET;
      resetRegistryStoreForTests();
    }
  });

  it("bounds a noncooperative response body without a second send", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    try {
      const db = memoryDb();
      const saved = await saveCustomConnection(db, "owner", { label: "Body", kind: "http", url: "http://127.0.0.1:9/status", method: "GET" });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      let calls = 0;
      const result = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "request", timeoutMs: 20,
        fetch: async () => { calls += 1; return { ok: true, status: 200, headers: { get: () => null }, text: async () => new Promise<never>(() => {}) }; } });
      assert.equal(calls, 1);
      assert.equal(result.status, "timeout");
      assert.equal(result.text, "The server did not answer in time. Nothing was retried.");
    } finally {
      delete process.env.CONNECTOR_TOKEN_SECRET;
      resetRegistryStoreForTests();
    }
  });
});
