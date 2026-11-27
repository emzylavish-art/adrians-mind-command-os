import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { activeStdioChildren, stdioSpawnCount } from "./stdio.ts";
import {
  BUILTIN_ID,
  callRegistryTool,
  listRegistryServers,
  listRegistryTools,
  registerExternalServer,
  removeRegistryServer,
  setMcpRegistryDirectory,
  setServerEnabled,
} from "./registry.ts";

describe("mcp registry", () => {
  it("always includes the built-in server enabled by default", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const servers = await listRegistryServers("owner");
    assert.equal(servers.some((s) => s.id === BUILTIN_ID && s.enabled), true);
  });

  it("toggles enabled and refuses calls when disabled", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    await setServerEnabled("owner", BUILTIN_ID, false);
    const listed = await listRegistryServers("owner");
    assert.equal(listed.find((s) => s.id === BUILTIN_ID)?.enabled, false);
    const called = await callRegistryTool({
      userId: "owner",
      serverId: BUILTIN_ID,
      tool: "pglite_query",
      args: { sql: "SELECT 1" },
      getSql: async () => ({ query: async () => [{ "?column?": 1 }] }),
    });
    assert.equal(called.ok, false);
    assert.match(called.text, /disabled/i);
  });

  it("disabling, re-enabling and removing invalidate pending owner MCP approvals", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-revoke-")));
    const records = new Map<string, { id: string; record: unknown }>();
    const revoked: unknown[][] = [];
    const db = { query: async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
      if (text.startsWith("DELETE FROM mind_mcp_call_approvals")) { revoked.push(params); return []; }
      if (text.startsWith("select record")) return [...records.values()].map(item => ({ record: item.record })) as T[];
      if (text.startsWith("select id")) return [...records.values()].map(item => ({ id: item.id })) as T[];
      if (text.startsWith("insert into mind_mcp_registry")) { records.set(String(params[1]), { id: String(params[1]), record: JSON.parse(String(params[2])) }); return []; }
      if (text.startsWith("delete from mind_mcp_registry")) { records.delete(String(params[1])); return []; }
      throw new Error("Unexpected fixture SQL");
    } };
    const saved = await registerExternalServer("owner", { label: "Fixture", url: "https://mcp.example/tools" }, db);
    assert.equal(saved.ok, true); if (!saved.ok) return;
    const server = saved.servers.find(item => item.label === "Fixture")!;
    await setServerEnabled("owner", server.id, false, db);
    await setServerEnabled("owner", server.id, true, db);
    await removeRegistryServer("owner", server.id, db);
    assert.deepEqual(revoked, [["owner"], ["owner"], ["owner"]]);
    assert.equal((await listRegistryServers("owner", db)).some(item => item.id === server.id), false);
  });

  it("calls pglite_query on the built-in server", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const called = await callRegistryTool({
      userId: "owner",
      serverId: BUILTIN_ID,
      tool: "pglite_query",
      args: { sql: "SELECT 1 AS n" },
      getSql: async () => ({ query: async () => [{ n: 1 }] }),
    });
    assert.equal(called.status, "ok");
    assert.equal(called.ok, true);
    assert.match(called.text, /"n": 1/);
  });

  it("lists built-in tools and registers an external URL server", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const tools = await listRegistryTools("owner");
    assert.equal(tools.some((t) => t.name === "pglite_query"), true);
    const saved = await registerExternalServer("owner", { label: "Desk", url: "https://mcp.example/tools", token: "secret" });
    assert.equal(saved.ok, true);
    if (saved.ok) {
      assert.equal(JSON.stringify(saved.servers).includes("secret"), false);
      assert.equal(saved.servers.some((s) => s.label === "Desk" && s.kind === "http"), true);
    }
  });

  it("returns honest pc_run_shell failure through the registry", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const called = await callRegistryTool({
      userId: "owner",
      serverId: BUILTIN_ID,
      tool: "pc_run_shell",
      args: { command: "pwd", confirm: true },
      getSql: async () => ({ query: async () => [] }),
    });
    assert.equal(called.ok, false);
    assert.match(called.text, /No paired PC online/);
  });

  process.env.MIND_MCP_STDIO_ALLOW = process.execPath;
  const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/mcp/fixture-stdio-server.mjs");
  const noSql = async () => ({ query: async () => [] });

  async function registerFixture(owner: string, env?: Record<string, string>) {
    const saved = await registerExternalServer(owner, { label: "Fixture stdio", command: process.execPath, args: [FIXTURE], env });
    assert.equal(saved.ok, true);
    if (!saved.ok) throw new Error("register failed");
    const server = saved.servers.find((s) => s.kind === "command");
    assert.ok(server);
    return server!;
  }

  it("registers command servers disabled, hides env values from the client", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const server = await registerFixture("owner", { API_KEY: "super-secret-value" });
    assert.equal(server.enabled, false);
    assert.deepEqual(server.envKeys, ["API_KEY"]);
    assert.equal(JSON.stringify(await listRegistryServers("owner")).includes("super-secret-value"), false);
  });

  it("never spawns a disabled stdio server on list or call", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const marker = join(mkdtempSync(join(tmpdir(), "mind-mcp-marker-")), "spawned");
    const server = await registerFixture("owner", { MCP_FIXTURE_MARKER: marker });
    const before = stdioSpawnCount();
    const tools = await listRegistryTools("owner");
    const row = tools.find((t) => t.serverId === server.id);
    assert.equal(row?.name, "(disabled)");
    assert.equal(row?.status, "disabled");
    const called = await callRegistryTool({ userId: "owner", serverId: server.id, tool: "echo", args: { text: "x" }, getSql: noSql });
    assert.equal(called.ok, false);
    assert.equal(called.status, "error");
    assert.match(called.text, /disabled/i);
    assert.equal(stdioSpawnCount(), before);
    assert.equal(existsSync(marker), false);
  });

  it("does not spawn when the emergency stop is on", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const server = await registerFixture("owner");
    await setServerEnabled("owner", server.id, true);
    const before = stdioSpawnCount();
    const tools = await listRegistryTools("owner", undefined, { isHalted: () => true });
    assert.equal(tools.find((t) => t.serverId === server.id)?.name, "(halted)");
    const called = await callRegistryTool({ userId: "owner", serverId: server.id, tool: "echo", args: { text: "x" }, getSql: noSql, isHalted: () => true });
    assert.equal(called.ok, false);
    assert.match(called.text, /Emergency stop/);
    assert.equal(stdioSpawnCount(), before);
  });

  it("lists and calls real tools on an enabled stdio server, then reaps the child", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const server = await registerFixture("owner");
    await setServerEnabled("owner", server.id, true);
    const tools = await listRegistryTools("owner", undefined, { isHalted: () => false });
    const names = tools.filter((t) => t.serverId === server.id).map((t) => t.name).sort();
    assert.deepEqual(names, ["add", "echo", "env_probe", "fail", "sleep"]);
    assert.equal(tools.some((t) => t.name === "pglite_query"), true);
    const called = await callRegistryTool({
      userId: "owner",
      serverId: server.id,
      tool: "echo",
      args: { text: "hello" },
      getSql: noSql,
      isHalted: () => false,
    });
    assert.equal(called.status, "ok");
    assert.equal(called.ok, true);
    assert.equal(called.text, "echo: hello");
    assert.equal(activeStdioChildren(), 0);
  });

  it("surfaces timeout status through the registry", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const server = await registerFixture("owner");
    await setServerEnabled("owner", server.id, true);
    const called = await callRegistryTool({
      userId: "owner",
      serverId: server.id,
      tool: "sleep",
      args: { ms: 120_000 },
      getSql: noSql,
      isHalted: () => false,
      stdio: { callTimeoutMs: 500 },
    });
    assert.equal(called.status, "timeout");
    assert.equal(called.ok, false);
    assert.equal(activeStdioChildren(), 0);
  });

  it("REGRESSION: an enabled command server outside the operator allowlist never spawns", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const marker = join(mkdtempSync(join(tmpdir(), "mind-mcp-marker-")), "spawned");
    const server = await registerFixture("attacker", { MCP_FIXTURE_MARKER: marker, LD_PRELOAD: "/tmp/evil.so", NODE_OPTIONS: "--require /tmp/x.js" });
    assert.deepEqual(server.envKeys, ["MCP_FIXTURE_MARKER"]);
    await setServerEnabled("attacker", server.id, true);
    const saved = process.env.MIND_MCP_STDIO_ALLOW;
    delete process.env.MIND_MCP_STDIO_ALLOW;
    try {
      const before = stdioSpawnCount();
      const tools = await listRegistryTools("attacker", undefined, { isHalted: () => false });
      const row = tools.find((t) => t.serverId === server.id);
      assert.equal(row?.status, "error");
      assert.match(row?.description ?? "", /allowlist/);
      const called = await callRegistryTool({ userId: "attacker", serverId: server.id, tool: "echo", args: { text: "x" }, getSql: noSql, isHalted: () => false });
      assert.equal(called.ok, false);
      assert.equal(called.status, "error");
      assert.match(called.text, /allowlist/);
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(stdioSpawnCount(), before);
      assert.equal(existsSync(marker), false);
    } finally {
      process.env.MIND_MCP_STDIO_ALLOW = saved;
    }
  });
});
