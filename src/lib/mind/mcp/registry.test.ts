import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
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
});
