#!/usr/bin/env node
/**
 * Live / local verification of MCP tools after hardening.
 * Prefers a running preview base URL (MCP_VERIFY_BASE), else starts nothing and
 * exercises in-process + local MCP HTTP (same handlers as UI routes).
 * Log: /workspace/audit/mcp-integration/live-verify.log
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const AUDIT = "/workspace/audit/mcp-integration";
mkdirSync(AUDIT, { recursive: true });
const LOG = join(AUDIT, "live-verify.log");
writeFileSync(LOG, "");
const lines = [];
function log(line) {
  const row = `[${new Date().toISOString()}] ${line}`;
  lines.push(row);
  console.log(row);
  appendFileSync(LOG, row + "\n");
}

const root = process.cwd();
const base = (process.env.MCP_VERIFY_BASE || "").replace(/\/$/, "");

async function probeBase(url) {
  try {
    const res = await fetch(url + "/", { signal: AbortSignal.timeout(3000) });
    return { ok: res.ok || res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function main() {
  log(`cwd=${root}`);
  log(`MCP_VERIFY_BASE=${base || "(unset)"}`);

  // Discover common local preview ports
  const candidates = [base, "http://127.0.0.1:8080", "http://127.0.0.1:8083", "http://127.0.0.1:8095"].filter(Boolean);
  let liveBase = null;
  for (const c of candidates) {
    const probe = await probeBase(c);
    log(`probe ${c}: ${JSON.stringify(probe)}`);
    if (probe.ok) {
      liveBase = c;
      break;
    }
  }
  log(`selected liveBase=${liveBase || "(none — local-only handlers)"}`);

  // --- In-process / local MCP HTTP (same code paths as UI server fns / builtin route) ---
  const dir = mkdtempSync(join(tmpdir(), "mcp-live-"));
  process.env.CONNECTOR_TOKEN_SECRET = process.env.CONNECTOR_TOKEN_SECRET || "live-verify-secret";
  const registry = await import(pathToFileURL(join(root, "src/lib/mind/mcp/registry.ts")).href);
  const tools = await import(pathToFileURL(join(root, "src/lib/mind/mcp/tools.ts")).href);
  const pairing = await import(pathToFileURL(join(root, "src/lib/mind/pc-pairing/store.ts")).href);
  const runPair = await import(pathToFileURL(join(root, "src/lib/mind/pc-pairing/run.ts")).href);
  const { handleBuiltinMcpHttp } = await import(pathToFileURL(join(root, "src/lib/mind/mcp/builtin-server.ts")).href);
  registry.setMcpRegistryDirectory(dir);
  pairing.setPcPairingDirectory(join(dir, "pc"));

  const pg = new PGlite();
  const sqlClient = {
    query: async (text, params = []) => (await pg.query(text, params)).rows,
  };
  const getSql = async () => sqlClient;

  // 1) pglite_query
  const q = await registry.callRegistryTool({
    userId: "verify",
    serverId: registry.BUILTIN_ID,
    tool: "pglite_query",
    args: { sql: "SELECT 1 AS n" },
    getSql,
  });
  log(`[local] pglite_query: ok=${q.ok} status=${q.status} text=${q.text.replace(/\n/g, " ").slice(0, 200)}`);

  // 2) notion tools — expect not configured
  const nr = await registry.callRegistryTool({
    userId: "verify",
    serverId: registry.BUILTIN_ID,
    tool: "notion_read_page",
    args: { page_id: "40b1aa27632381768d58cde0731f142a" },
    getSql,
  });
  log(`[local] notion_read_page: ${nr.text}`);
  const na = await registry.callRegistryTool({
    userId: "verify",
    serverId: registry.BUILTIN_ID,
    tool: "notion_append_section",
    args: { page_id: "40b1aa27632381768d58cde0731f142a", heading: "x", markdown: "y" },
    getSql,
  });
  log(`[local] notion_append_section: ${na.text}`);

  // 3) pc_run_shell with simulated agent
  const reg = pairing.registerAgent({ ownerId: "verify", label: "Sim Verify PC" });
  log(`[local] register agent ok=${reg.ok}`);
  let simDone = false;
  const interval = setInterval(() => {
    if (!reg.ok) return;
    const job = pairing.claimNextJob(reg.agentId);
    if (!job) return;
    pairing.completeJob({ jobId: job.id, agentId: reg.agentId, ok: true, output: "sim-ok\n" });
    simDone = true;
    clearInterval(interval);
  }, 20);
  const pc = await tools.pcRunShell({
    command: "pwd",
    confirm: false,
    ownerId: "verify",
    pairingRunner: async (args) => {
      const r = await runPair.runOnPairedAgent({ ...args, timeoutMs: 3000, pollMs: 20 });
      if (!r) return null;
      return { ok: r.ok, status: r.status, text: r.text, data: r.data };
    },
  });
  clearInterval(interval);
  log(`[local] pc_run_shell simulated: ok=${pc.ok} text=${pc.text.trim()} simDone=${simDone}`);

  const pcNone = await tools.pcRunShell({ command: "pwd", confirm: true, ownerId: "nobody", env: {} });
  log(`[local] pc_run_shell no agent: ${pcNone.text}`);

  // 4) toggle-off gating
  registry.setServerEnabled("verify", registry.BUILTIN_ID, false);
  const gated = await registry.callRegistryTool({
    userId: "verify",
    serverId: registry.BUILTIN_ID,
    tool: "pglite_query",
    args: { sql: "SELECT 1" },
    getSql,
  });
  log(`[local] toggle-off gate: ok=${gated.ok} text=${gated.text}`);
  registry.setServerEnabled("verify", registry.BUILTIN_ID, true);

  // 5) MCP HTTP tools/call (builtin handler — same as /api/mind/mcp/builtin)
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const response = await handleBuiltinMcpHttp(request, { getSql, authenticate: async () => "verify-user" });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const mcpUrl = `http://127.0.0.1:${port}/mcp`;
  async function rpc(message) {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(message),
    });
    const text = await res.text();
    return { status: res.status, text };
  }
  await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify", version: "1" } },
  });
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  const called = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "pglite_query", arguments: { sql: "SELECT 1 AS n" } },
  });
  log(`[local-mcp-http] tools/call pglite_query status=${called.status} body=${called.text.slice(0, 400)}`);
  server.close();

  // 6) Against live preview HTTP routes (auth may 401)
  if (liveBase) {
    for (const path of [
      "/api/mind/mcp/servers",
      "/api/mind/mcp/tools",
      "/api/mind/pc/status",
      "/api/mind/oauth/notion/status",
    ]) {
      try {
        const res = await fetch(liveBase + path, { signal: AbortSignal.timeout(5000) });
        const text = await res.text();
        log(`[live-http] GET ${path} -> ${res.status} ${text.slice(0, 180).replace(/\n/g, " ")}`);
      } catch (e) {
        log(`[live-http] GET ${path} -> error ${e}`);
      }
    }
    try {
      const res = await fetch(liveBase + "/api/mind/mcp/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serverId: "builtin-mind", tool: "pglite_query", args: { sql: "SELECT 1 AS n" } }),
        signal: AbortSignal.timeout(5000),
      });
      const text = await res.text();
      log(`[live-http] POST /api/mind/mcp/call -> ${res.status} ${text.slice(0, 240).replace(/\n/g, " ")}`);
    } catch (e) {
      log(`[live-http] POST /api/mind/mcp/call -> error ${e}`);
    }
    try {
      const res = await fetch(liveBase + "/api/mind/mcp/builtin", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify", version: "1" } },
        }),
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      log(`[live-http] POST /api/mind/mcp/builtin initialize -> ${res.status} ${text.slice(0, 240).replace(/\n/g, " ")}`);
    } catch (e) {
      log(`[live-http] builtin -> error ${e}`);
    }
  } else {
    log("[live-http] skipped — no reachable preview for this branch");
  }

  log(
    `summary: local tool checks done; liveBase=${liveBase || "none"}; notion not configured expected; pc simulated; toggle gate verified; live routes may require sign-in (401 is honest).`,
  );
  await pg.close?.();
  if (!q.ok || gated.ok || !pc.ok) process.exitCode = 1;
}

main().catch((e) => {
  log(String(e?.stack || e));
  process.exit(1);
});
