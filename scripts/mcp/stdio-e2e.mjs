#!/usr/bin/env node
/**
 * Real end-to-end check for stdio (kind=command) MCP servers through the registry.
 * Spawns scripts/mcp/fixture-stdio-server.mjs via the SDK StdioClientTransport:
 *  1) disabled server: list + call never spawn (marker file absent, spawn count unchanged)
 *  2) enabled: tools/list returns the fixture's real tools
 *  3) tools/call echo + add return ok with real output
 *  4) slow tools/call times out with status=timeout
 *  5) hung initialize times out on connect with status=timeout
 *  0) enabled server whose command is NOT on MIND_MCP_STDIO_ALLOW never spawns
 *  6) no fixture child process left alive afterwards
 * Writes /workspace/audit/mcp-integration/stdio-e2e.log. Exit 1 on any failure.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const AUDIT = "/workspace/audit/mcp-integration";
mkdirSync(AUDIT, { recursive: true });
const root = process.cwd();
const FIXTURE = join(root, "scripts/mcp/fixture-stdio-server.mjs");
const lines = [];
let failures = 0;
function log(line) {
  const row = `[${new Date().toISOString()}] ${line}`;
  lines.push(row);
  console.log(row);
}
function check(name, cond, detail = "") {
  if (!cond) failures += 1;
  log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function fixtureProcs() {
  try {
    return execFileSync("pgrep", ["-f", FIXTURE], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  const registry = await import(pathToFileURL(join(root, "src/lib/mind/mcp/registry.ts")).href);
  const stdio = await import(pathToFileURL(join(root, "src/lib/mind/mcp/stdio.ts")).href);
  registry.setMcpRegistryDirectory(mkdtempSync(join(tmpdir(), "mind-mcp-stdio-e2e-")));
  const owner = "stdio-e2e-owner";
  const noSql = async () => ({ query: async () => [] });
  const notHalted = () => false;
  const procsBefore = fixtureProcs().length;
  // Operator allowlist: only this node binary may be spawned in the e2e.
  process.env.MIND_MCP_STDIO_ALLOW = process.execPath;

  const marker = join(mkdtempSync(join(tmpdir(), "mind-mcp-marker-")), "spawned");
  const saved = registry.registerExternalServer(owner, {
    label: "Fixture stdio",
    command: process.execPath,
    args: [FIXTURE],
    env: { MCP_FIXTURE_MARKER: marker },
  });
  check("register command server", saved.ok === true);
  const server = saved.servers.find((s) => s.kind === "command");
  check("registered disabled by default", server?.enabled === false);

  const spawnsBefore = stdio.stdioSpawnCount();
  const disabledList = await registry.listRegistryTools(owner, undefined, { isHalted: notHalted });
  const disabledCall = await registry.callRegistryTool({ userId: owner, serverId: server.id, tool: "echo", args: { text: "x" }, getSql: noSql, isHalted: notHalted });
  check("disabled list shows (disabled)", disabledList.some((t) => t.serverId === server.id && t.name === "(disabled)"));
  check("disabled call refuses", disabledCall.ok === false && /disabled/i.test(disabledCall.text), disabledCall.text);
  check("disabled never spawned", stdio.stdioSpawnCount() === spawnsBefore && !existsSync(marker), `spawns=${stdio.stdioSpawnCount() - spawnsBefore} marker=${existsSync(marker)}`);

  registry.setServerEnabled(owner, server.id, true);
  const savedAllow = process.env.MIND_MCP_STDIO_ALLOW;
  delete process.env.MIND_MCP_STDIO_ALLOW;
  const deniedList = await registry.listRegistryTools(owner, undefined, { isHalted: notHalted });
  const deniedCall = await registry.callRegistryTool({ userId: owner, serverId: server.id, tool: "echo", args: { text: "x" }, getSql: noSql, isHalted: notHalted });
  check(
    "not allowlisted -> refused, never spawned",
    deniedList.some((t) => t.serverId === server.id && t.status === "error" && /allowlist/.test(t.description)) &&
      deniedCall.ok === false && /allowlist/.test(deniedCall.text) && stdio.stdioSpawnCount() === spawnsBefore && !existsSync(marker),
    deniedCall.text,
  );
  process.env.MIND_MCP_STDIO_ALLOW = savedAllow ?? process.execPath;
  let t0 = Date.now();
  const listed = await registry.listRegistryTools(owner, undefined, { isHalted: notHalted });
  const names = listed.filter((t) => t.serverId === server.id).map((t) => t.name).sort();
  check("tools/list real fixture tools", names.join(",") === "add,echo,env_probe,fail,sleep", `${names.join(",")} in ${Date.now() - t0}ms`);
  check("enabled list actually spawned", existsSync(marker));

  t0 = Date.now();
  const echo = await registry.callRegistryTool({ userId: owner, serverId: server.id, tool: "echo", args: { text: "hello stdio" }, getSql: noSql, isHalted: notHalted });
  check("tools/call echo ok", echo.status === "ok" && echo.text === "echo: hello stdio", `${echo.status}: ${echo.text} in ${Date.now() - t0}ms`);
  const add = await registry.callRegistryTool({ userId: owner, serverId: server.id, tool: "add", args: { a: 19, b: 23 }, getSql: noSql, isHalted: notHalted });
  check("tools/call add ok", add.status === "ok" && add.text === "42", `${add.status}: ${add.text} data=${JSON.stringify(add.data)}`);
  const fail = await registry.callRegistryTool({ userId: owner, serverId: server.id, tool: "fail", args: {}, getSql: noSql, isHalted: notHalted });
  check("tools/call isError -> status error", fail.status === "error" && fail.ok === false, `${fail.status}: ${fail.text}`);

  t0 = Date.now();
  const slow = await registry.callRegistryTool({
    userId: owner,
    serverId: server.id,
    tool: "sleep",
    args: { ms: 120000 },
    getSql: noSql,
    isHalted: notHalted,
    stdio: { callTimeoutMs: 1000 },
  });
  check("slow tools/call -> timeout", slow.status === "timeout" && slow.ok === false, `${slow.status}: ${slow.text.split("\n")[0]} in ${Date.now() - t0}ms`);

  const hung = registry.registerExternalServer(owner, {
    label: "Hung init",
    command: process.execPath,
    args: [FIXTURE],
    env: { MCP_FIXTURE_HANG_INIT: "1" },
    connectTimeoutMs: 1000,
  });
  const hungServer = hung.servers.find((s) => s.label === "Hung init");
  registry.setServerEnabled(owner, hungServer.id, true);
  t0 = Date.now();
  const hungCall = await registry.callRegistryTool({ userId: owner, serverId: hungServer.id, tool: "echo", args: { text: "x" }, getSql: noSql, isHalted: notHalted });
  check("hung initialize -> timeout", hungCall.status === "timeout", `${hungCall.status}: ${hungCall.text.split("\n")[0]} in ${Date.now() - t0}ms`);

  check("no live stdio children tracked", stdio.activeStdioChildren() === 0, `active=${stdio.activeStdioChildren()}`);
  await new Promise((r) => setTimeout(r, 300));
  const procsAfter = fixtureProcs().length;
  check("no fixture processes left running", procsAfter <= procsBefore, `before=${procsBefore} after=${procsAfter}`);

  log(failures === 0 ? "RESULT PASS" : `RESULT FAIL (${failures})`);
  writeFileSync(join(AUDIT, "stdio-e2e.log"), `${lines.join("\n")}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  log(`FATAL ${error instanceof Error ? error.stack : String(error)}`);
  writeFileSync(join(AUDIT, "stdio-e2e.log"), `${lines.join("\n")}\n`);
  process.exit(1);
});
