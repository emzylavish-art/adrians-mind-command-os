import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { runNotionTurn } from "./notion.ts";
import { notionIntegrationStatus } from "./notion-integration-status.ts";
import { notionReceiptStore } from "./notion-write-receipt.ts";
import { callCustomConnection, listCustomConnections, readOperationSchema, saveCustomConnection, validateArgs } from "./custom-connection.ts";
import { runConnectedMcpTurn } from "./connected-mcp.server.ts";
import { callRegistryTool } from "./mcp/registry.ts";
import { acceptResult, dismissResult } from "../../components/mind/custom-connection-result.ts";

function sqlFor(database: () => PGlite): Sql {
  const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const query = parts.reduce((text, part, index) => `${text}${index ? `$${index}` : ""}${part}`, "");
    return (await database().query(query, values)).rows;
  }) as Sql;
  sql.query = async <T>(query: string, values: unknown[] = []) => (await database().query<T>(query, values)).rows;
  return sql;
}

const note = "preserve this exact note";
const text = `Append ${note} to the Notion page about roadmap`;
const page = { object: "page", id: "page-a", url: "https://www.notion.so/page-a", properties: { Name: { title: [{ plain_text: "Roadmap" }] } } };
const block = { id: "new-block-id", type: "paragraph", paragraph: { rich_text: [{ plain_text: note }] } };

test("AA001 acknowledged append uses its new block identity; recovery survives restart and never repeats PATCH", async () => {
  const directory = await mkdtemp(join(tmpdir(), "audit-notion-receipts-"));
  let database = new PGlite(directory);
  const sql = sqlFor(() => database);
  let readbackAllowed = false;
  const calls: string[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    calls.push(`${init?.method} ${path}`);
    const body = path === "/v1/search" ? { results: [page] }
      : init?.method === "PATCH" ? { results: [block] }
      : path === "/v1/blocks/new-block-id" ? block : { results: [{ ...block, id: "old-identical-block" }] };
    const status = path === "/v1/blocks/new-block-id" && !readbackAllowed ? 403 : 200;
    return { ok: status === 200, status, json: async () => body };
  };
  const operationId = randomUUID();
  const input = { token: "fixture-not-a-key", disabled: false, text, confirmed: true, pageId: "page-a", workspaceId: "workspace-a", operationId, fetch };
  try {
    await database.exec(await readFile(new URL("../../../migrations/0004_tool_run.sql", import.meta.url), "utf8"));
    const first = await runNotionTurn({ ...input, receipts: notionReceiptStore(sql, "owner-a") });
    assert.equal(first.wrote, true);
    assert.equal(first.verified, false);
    assert.equal(first.recovery, "verify_only");
    assert.equal(calls.some((call) => /children\?/.test(call)), false, "a preview or old identical block cannot verify the new write");
    await database.close();
    database = new PGlite(directory);
    readbackAllowed = true;
    const recovered = await runNotionTurn({ ...input, confirmed: false, recoveryOnly: true, receipts: notionReceiptStore(sql, "owner-a") });
    assert.equal(recovered.verified, true);
    assert.equal(calls.filter((call) => call.startsWith("PATCH")).length, 1);
    assert.equal(calls.filter((call) => call.includes("search")).length, 1, "recovery remains on the acknowledged destination");
    const changed = await runNotionTurn({ ...input, workspaceId: "workspace-b", receipts: notionReceiptStore(sql, "owner-a") });
    assert.match(changed.error, /cannot be reused/);
    assert.equal(calls.filter((call) => call.startsWith("PATCH")).length, 1);
    assert.equal(await notionReceiptStore(sql, "owner-b").read(operationId), null);
    const stored = JSON.stringify((await database.query("select detail from mind_tool_run")).rows);
    assert.equal(stored.includes(note), false);
    assert.equal(stored.includes("fixture-not-a-key"), false);
  } finally {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("AA001 simultaneous confirmation and lost acknowledgement issue at most one append", async () => {
  const database = new PGlite();
  const sql = sqlFor(() => database);
  let appends = 0;
  try {
    await database.exec(await readFile(new URL("../../../migrations/0004_tool_run.sql", import.meta.url), "utf8"));
    const input = {
      token: "synthetic", disabled: false, text, confirmed: true, pageId: "page-a", workspaceId: "workspace-a", operationId: randomUUID(),
      receipts: notionReceiptStore(sql, "owner"),
      fetch: async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") { appends += 1; throw new Error("Acknowledgement lost after fixture commit"); }
        return { ok: true, status: 200, json: async () => ({ results: [page] }) };
      },
    };
    const attempts = await Promise.all([runNotionTurn(input), runNotionTurn(input)]);
    assert.equal(appends, 1);
    assert.ok(attempts.every((result) => !result.ok));
    const retry = await runNotionTurn({ ...input, recoveryOnly: true });
    assert.equal(appends, 1);
    assert.equal(retry.writeOutcome, "unknown");
    assert.equal(retry.recovery, "inspect_page");
    assert.doesNotMatch(retry.error, /Nothing was changed/);
  } finally { await database.close(); }
});

test("AA018 constraints survive discovery and reject invalid arguments before dispatch", () => {
  const schema = readOperationSchema({ type: "object", properties: {
    format: { type: "string", enum: ["markdown", "text"] },
    count: { type: "integer", minimum: 1, maximum: 4 },
    include: { type: "boolean" },
    code: { type: "string", minLength: 2, maxLength: 3, pattern: "^[A-Z]+$" },
  }, required: ["format", "count", "include", "code"] });
  assert.ok(schema);
  const valid = { format: "markdown", count: 2, include: false, code: "AB" };
  assert.deepEqual(validateArgs(schema, valid), { ok: true, args: valid });
  for (const args of [{ ...valid, format: "xml" }, { ...valid, count: 5 }, { ...valid, count: 0 }, { ...valid, include: "garbage" }, { ...valid, code: "aB" }, { ...valid, code: "A" }, { ...valid, code: "ABCD" }]) assert.equal(validateArgs(schema, args).ok, false);
  for (const property of [{ type: "object", properties: {} }, { type: "string", format: "email" }, { type: "string", pattern: "(a+)+$" }, { type: "integer", multipleOf: 2 }]) {
    assert.equal(readOperationSchema({ type: "object", properties: { value: property } }), null);
  }
  assert.equal(readOperationSchema({ type: "object", properties: {}, required: ["missing"] }), null);
});

test("AA017 changed MCP schemas and descriptions require fresh review; unchanged call is executed once", async () => {
  const database = new PGlite();
  const db = sqlFor(() => database);
  const beforeSecret = process.env.CONNECTOR_TOKEN_SECRET;
  process.env.CONNECTOR_TOKEN_SECRET = "synthetic-audit-secret";
  let changed = false;
  let description = "Read a fixture";
  const calls: Record<string, unknown>[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body));
    if (message.method === "tools/call") calls.push(message.params.arguments);
    const result = message.method === "tools/list" ? { tools: [{ name: "lookup", description, inputSchema: { type: "object", properties: { id: { type: "string" }, ...(changed ? { locale: { type: "string" } } : {}) }, required: changed ? ["id", "locale"] : ["id"] } }] }
      : message.method === "initialize" ? { protocolVersion: "2024-11-05" } : { content: [{ type: "text", text: "fixture result" }] };
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) };
  };
  try {
    for (const migration of ["0005_custom_connection.sql", "0016_mcp_call_approvals.sql"]) await database.exec(await readFile(new URL(`../../../migrations/${migration}`, import.meta.url), "utf8"));
    const saved = await saveCustomConnection(db, "owner", { label: "Fixture MCP", kind: "mcp", url: "http://localhost/mcp" }, { fetch });
    assert.ok(saved.ok);
    const turn = (args: Record<string, unknown>, confirmed = false, approvalId?: string) => runConnectedMcpTurn({ db, userId: "owner", text: `call MCP tool lookup on server ${saved.connection.id} ${JSON.stringify(args)}`, confirmed, approvalId, approvalServerId: confirmed ? saved.connection.id : undefined, fetch, isHalted: () => false });
    const review = await turn({ id: "one" });
    changed = true;
    const blocked = await turn({ id: "one" }, true, review.approvalId);
    assert.match(blocked.error, /definition changed/);
    assert.equal(calls.length, 0);
    const current = (await listCustomConnections(db, "owner"))[0];
    assert.deepEqual(current.operations[0].inputSchema?.required, ["id", "locale"]);
    const corrected = { id: "one", locale: "en" };
    const fresh = await turn(corrected);
    assert.ok((await turn(corrected, true, fresh.approvalId)).ok);
    assert.deepEqual(calls, [corrected]);
    assert.equal((await turn(corrected, true, fresh.approvalId)).ok, false);
    const another = await turn(corrected);
    description = "Create a fixture";
    assert.match((await turn(corrected, true, another.approvalId)).error, /definition changed/);
    assert.equal(calls.length, 1);
  } finally {
    if (beforeSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET; else process.env.CONNECTOR_TOKEN_SECRET = beforeSecret;
    await database.close();
  }
});

test("AA025 halt arriving during MCP initialization prevents both custom and registry dispatch", async () => {
  const database = new PGlite();
  const db = sqlFor(() => database);
  const beforeSecret = process.env.CONNECTOR_TOKEN_SECRET;
  process.env.CONNECTOR_TOKEN_SECRET = "synthetic-audit-secret";
  let haltOnInitialize = false;
  let stopped = false;
  let calls = 0;
  const fetch = async (_url: string, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body));
    if (message.method === "initialize" && haltOnInitialize) stopped = true;
    if (message.method === "tools/call") calls += 1;
    const result = message.method === "tools/list" ? { tools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }] } : { protocolVersion: "2024-11-05" };
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) };
  };
  try {
    await database.exec(await readFile(new URL("../../../migrations/0005_custom_connection.sql", import.meta.url), "utf8"));
    const saved = await saveCustomConnection(db, "owner", { label: "Fixture MCP", kind: "mcp", url: "http://localhost/mcp" }, { fetch });
    assert.ok(saved.ok);
    haltOnInitialize = true;
    const custom = await callCustomConnection({ db, userId: "owner", id: saved.connection.id, operation: "lookup", confirmed: true, fetch, isHalted: () => stopped });
    assert.match(custom.text, /Emergency stop/);
    stopped = false;
    const registry = await callRegistryTool({ registryDb: db, userId: "owner", serverId: saved.connection.id, tool: "lookup", getSql: async () => db, fetch, isHalted: () => stopped });
    assert.match(registry.text, /Emergency stop/);
    assert.equal(calls, 0);
  } finally {
    if (beforeSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET; else process.env.CONNECTOR_TOKEN_SECRET = beforeSecret;
    await database.close();
  }
});

test("AA019 dismiss invalidates a delayed result and out-of-order replies cannot replace the new attempt", async () => {
  const activeAttempt = { current: "old" };
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; }).then(() => acceptResult(activeAttempt.current, { localAttemptId: "old", status: "ok", text: "old answer" }));
  assert.equal(dismissResult(activeAttempt), null);
  finish();
  assert.equal(await pending, "stale");
  activeAttempt.current = "new";
  assert.equal(acceptResult(activeAttempt.current, { localAttemptId: "old", status: "ok", text: "old answer" }), "stale");
  assert.equal((acceptResult(activeAttempt.current, { localAttemptId: "new", status: "ok", text: "new answer" }) as { text: string }).text, "new answer");
  const component = await readFile(new URL("../../components/mind/custom-connections.tsx", import.meta.url), "utf8");
  assert.match(component, /dismissResult\(activeAttempt\)/, "the mounted Dismiss control invalidates the same attempt ref used by completion");
});

test("AA017 missing tools, failed discovery, and a connection disabled during discovery all refuse dispatch", async () => {
  const database = new PGlite();
  const db = sqlFor(() => database);
  const beforeSecret = process.env.CONNECTOR_TOKEN_SECRET;
  process.env.CONNECTOR_TOKEN_SECRET = "synthetic-audit-secret";
  let mode = "valid";
  let connectionId = "";
  let calls = 0;
  const fetch = async (_url: string, init?: RequestInit) => {
    const message = JSON.parse(String(init?.body));
    if (message.method === "tools/call") calls += 1;
    if (mode === "disabled" && message.method === "tools/list") await db.query("update mind_mcp_registry set record = record || '{\"enabled\":false}'::jsonb where user_id=$1 and id=$2", ["owner", connectionId]);
    const result = message.method === "tools/list" ? { tools: mode === "removed" ? [] : [{ name: "lookup", inputSchema: { type: "object", properties: {} } }] } : { protocolVersion: "2024-11-05" };
    const rejected = mode === "unavailable" && message.method === "tools/list";
    return { ok: !rejected, status: rejected ? 503 : 200, headers: new Headers(), text: async () => JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) };
  };
  try {
    await database.exec(await readFile(new URL("../../../migrations/0005_custom_connection.sql", import.meta.url), "utf8"));
    for (const scenario of ["removed", "unavailable", "disabled", "stop-unavailable"]) {
      mode = "valid";
      const saved = await saveCustomConnection(db, "owner", { label: scenario, kind: "mcp", url: "http://localhost/mcp" }, { fetch });
      assert.ok(saved.ok);
      connectionId = saved.connection.id;
      mode = scenario;
      const result = await callCustomConnection({ db, userId: "owner", id: connectionId, operation: "lookup", confirmed: true, reviewedRevision: saved.connection.operations[0].revision, fetch,
        isHalted: () => { if (scenario === "stop-unavailable") throw new Error("fixture storage unavailable"); return false; } });
      assert.equal(result.ok, false, scenario);
      assert.equal(calls, 0, scenario);
      if (scenario === "disabled") assert.equal((await listCustomConnections(db, "owner")).find((item) => item.id === connectionId)?.enabled, false, "discovery never re-enables a disabled connection");
    }
  } finally {
    if (beforeSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET; else process.env.CONNECTOR_TOKEN_SECRET = beforeSecret;
    await database.close();
  }
});


test("AA002 integration status uses the saved owner's grant and its own check time, never a catalog timestamp", () => {
  const snapshot = { ownerId: "a", checkedAt: "2026-11-25T12:00:00Z", status: { state: "connected", detail: "Saved", workspaceName: "Fixture workspace" } };
  const connected = notionIntegrationStatus("a", false, snapshot);
  assert.equal(connected.label, "Authorization saved");
  assert.match(connected.detail, /Fixture workspace/);
  assert.match(connected.detail, /not a successful API action/);
  assert.equal(connected.checkedAt, snapshot.checkedAt);
  assert.equal(notionIntegrationStatus("b", false, snapshot).label, "Checking");
  assert.equal(notionIntegrationStatus("b", false, snapshot).checkedAt, null);
  assert.equal(notionIntegrationStatus(null, false, snapshot).label, "Sign in required");
  assert.equal(notionIntegrationStatus("a", true, snapshot).label, "Checking sign-in");
  assert.equal(notionIntegrationStatus("a", false, { ...snapshot, status: { state: "unavailable", detail: "Status could not be read" } }).label, "Status unavailable");
  assert.equal(notionIntegrationStatus("a", false, { ...snapshot, status: { state: "not_connected", detail: "No grant saved" } }).label, "Not connected");
});
