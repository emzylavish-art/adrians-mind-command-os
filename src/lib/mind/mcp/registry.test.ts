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
  setMcpRegistryDirectory,
  setServerEnabled,
} from "./registry.ts";

describe("mcp registry", () => {
  it("always includes the built-in server enabled by default", () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const servers = listRegistryServers("owner");
    assert.equal(servers.some((s) => s.id === BUILTIN_ID && s.enabled), true);
  });

  it("toggles enabled and refuses calls when disabled", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    setServerEnabled("owner", BUILTIN_ID, false);
    const listed = listRegistryServers("owner");
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
    const saved = registerExternalServer("owner", { label: "Desk", url: "https://mcp.example/tools", token: "secret" });
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

  const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/mcp/fixture-stdio-server.mjs");
  const noSql = async () => ({ query: async () => [] });

  function registerFixture(owner: string, env?: Record<string, string>) {
    const saved = registerExternalServer(owner, { label: "Fixture stdio", command: process.execPath, args: [FIXTURE], env });
    assert.equal(saved.ok, true);
    if (!saved.ok) throw new Error("register failed");
    const server = saved.servers.find((s) => s.kind === "command");
    assert.ok(server);
    return server!;
  }

  it("registers command servers disabled, hides env values from the client", () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const server = registerFixture("owner", { API_KEY: "super-secret-value" });
    assert.equal(server.enabled, false);
    assert.deepEqual(server.envKeys, ["API_KEY"]);
    assert.equal(JSON.stringify(listRegistryServers("owner")).includes("super-secret-value"), false);
  });

  it("never spawns a disabled stdio server on list or call", async () => {
    setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-reg-")));
    const marker = join(mkdtempSync(join(tmpdir(), "mind-mcp-marker-")), "spawned");
    const server = registerFixture("owner", { MCP_FIXTURE_MARKER: marker });
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
    const server = registerFixture("owner");
    setServerEnabled("owner", server.id, true);
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
    const server = registerFixture("owner");
    setServerEnabled("owner", server.id, true);
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
    const server = registerFixture("owner");
    setServerEnabled("owner", server.id, true);
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
});
