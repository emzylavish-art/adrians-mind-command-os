import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { listConnectedMcp, removeConnectedMcp, runConnectedMcpTurn, saveConnectedMcp } from "./connected-mcp.server.ts";
import { listCustomConnections, refreshMcp } from "./custom-connection.ts";
import { decryptSecret } from "./connectors/crypto.ts";
import { callRegistryTool, listRegistryServers, listRegistryTools } from "./mcp/registry.ts";
import { loadRegistry, resetRegistryStoreForTests, saveRegistry, setConnectedLegacyDirectory, type RegistryDb } from "./mcp/registry-store.ts";

const SECRET = "test-connector-secret";
const TOKEN = "test-connected-bearer";
type Row = { userId: string; id: string; record: string };
const approvals = new Map<string, string>();
function memoryDb(rows: Row[] = []): RegistryDb & { rows: Row[] } {
  return {
    rows,
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      if (text.includes("mind_mcp_call_approvals")) {
        if (!params.length) return [];
        const [id, owner, digest] = params.map(String);
        if (text.startsWith("INSERT")) approvals.set(id, JSON.stringify([owner, digest]));
        else if (approvals.get(id) === JSON.stringify([owner, digest])) { approvals.delete(id); return [{ approval_id: id }] as T[]; }
        return [];
      }
      const userId = String(params[0]);
      if (text.startsWith("select record")) return rows.filter((row) => row.userId === userId).map((row) => ({ record: row.record })) as T[];
      if (text.startsWith("select id")) return rows.filter((row) => row.userId === userId).map((row) => ({ id: row.id })) as T[];
      const id = String(params[1]);
      const index = rows.findIndex((row) => row.userId === userId && row.id === id);
      if (text.startsWith("UPDATE mind_mcp_registry")) {
        if (index < 0) return [];
        const record = JSON.parse(rows[index].record);
        if (record.url !== params[3] || (record.tokenEnc ?? null) !== params[4] || record.deleted || !record.enabled) return [];
        if (text.includes("RETURNING id") && ((record.state ?? null) !== params[6] || (record.operations === undefined ? null : JSON.stringify(record.operations)) !== params[5])) return [];
        rows[index].record = JSON.stringify({ ...record, ...JSON.parse(String(params[2])) });
        return [{ id }] as T[];
      }
      if (text.startsWith("delete")) {
        if (index >= 0) rows.splice(index, 1);
      } else if (text.startsWith("insert")) {
        const row = { userId, id, record: String(params[2]) };
        if (index >= 0) rows[index] = row;
        else rows.push(row);
      } else throw new Error(`Unexpected test query: ${text}`);
      return [];
    },
  };
}

const operation = { name: "lookup", description: "Lookup an item", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } };
function fakeMcp(options: { failInitialize?: boolean; noSchema?: boolean; rpcInitializeError?: boolean } = {}) {
  const calls: { method: string; params?: { arguments?: unknown }; authorization?: string }[] = [];
  return {
    calls,
    fetch: async (_url: string, init?: RequestInit) => {
      const message = JSON.parse(String(init?.body));
      calls.push({ ...message, authorization: (init?.headers as Record<string, string>)?.authorization });
      const failed = options.failInitialize && message.method === "initialize";
      const result = message.method === "initialize"
        ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }
        : message.method === "tools/list"
          ? { tools: [options.noSchema ? { name: "lookup" } : operation] }
          : { content: [{ type: "text", text: "found" }] };
      return {
        ok: !failed,
        status: failed ? 401 : 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(options.rpcInitializeError && message.method === "initialize" ? { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "init refused" } } : { jsonrpc: "2.0", id: message.id, result }),
      };
    },
    isHalted: () => false,
  };
}
const input = { label: "Connected", url: "http://localhost/mcp", token: TOKEN };
let directory: string;
let oldSecret: string | undefined;

beforeEach(() => {
  oldSecret = process.env.CONNECTOR_TOKEN_SECRET;
  process.env.CONNECTOR_TOKEN_SECRET = SECRET;
  resetRegistryStoreForTests();
  directory = mkdtempSync(join(tmpdir(), "connected-durable-test-"));
  setConnectedLegacyDirectory(directory);
});
afterEach(() => {
  if (oldSecret === undefined) delete process.env.CONNECTOR_TOKEN_SECRET;
  else process.env.CONNECTOR_TOKEN_SECRET = oldSecret;
  resetRegistryStoreForTests();
  rmSync(directory, { recursive: true, force: true });
});

describe("Connected durable backend", { concurrency: false }, () => {
  it("saves, reloads, and removes only the authenticated owner with sealed credentials and the UI DTO", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const saved = await saveConnectedMcp(db, "owner", input, wire);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.servers[0].id, saved.savedId);
    assert.deepEqual(Object.keys(saved.servers[0]).sort(), ["error", "host", "id", "label", "state", "tools"]);
    assert.equal(saved.servers[0].state, "connected");
    assert.equal(saved.servers[0].host, "localhost");
    const raw = JSON.parse(db.rows.find((row) => row.id === saved.savedId)!.record);
    assert.equal(raw.token, undefined);
    assert.equal(decryptSecret(raw.tokenEnc), TOKEN);
    assert.ok(!JSON.stringify(db.rows).includes(TOKEN));
    assert.ok(!JSON.stringify(saved).includes(TOKEN));
    assert.ok(!JSON.stringify(saved).includes(raw.tokenEnc));
    assert.ok(wire.calls.every((call) => call.authorization === `Bearer ${TOKEN}`));
    resetRegistryStoreForTests();
    setConnectedLegacyDirectory(directory);
    assert.deepEqual(await listConnectedMcp(memoryDb(db.rows), "owner"), saved.servers);
    assert.deepEqual(await listConnectedMcp(memoryDb(db.rows), "stranger"), []);
    assert.deepEqual(await removeConnectedMcp(memoryDb(db.rows), "stranger", saved.savedId), []);
    assert.equal((await listConnectedMcp(memoryDb(db.rows), "owner")).length, 1);
    assert.deepEqual(await removeConnectedMcp(memoryDb(db.rows), "owner", saved.savedId), []);
    assert.deepEqual(await listConnectedMcp(memoryDb(db.rows), "owner"), []);
    assert.deepEqual(readdirSync(directory), []);
  });

  it("fails closed before transport or legacy writes without database or encryption secret", async () => {
    const wire = fakeMcp();
    const noDb = await saveConnectedMcp(null, "owner", input, wire);
    assert.equal(noDb.ok, false);
    await assert.rejects(listConnectedMcp(null, "owner"), /durable database/);
    await assert.rejects(removeConnectedMcp(null, "owner", "id"), /durable database/);
    const db = memoryDb();
    delete process.env.CONNECTOR_TOKEN_SECRET;
    const noSecret = await saveConnectedMcp(db, "owner", input, wire);
    assert.equal(noSecret.ok, false);
    if (!noSecret.ok) assert.match(noSecret.error, /CONNECTOR_TOKEN_SECRET/);
    assert.equal(db.rows.length, 0);
    assert.equal(wire.calls.length, 0);
    assert.deepEqual(readdirSync(directory), []);
  });

  it("never labels a failed handshake or schema-less tools connected, and identifies the failed saved row", async () => {
    const db = memoryDb();
    const good = await saveConnectedMcp(db, "owner", input, fakeMcp());
    assert.equal(good.ok, true);
    for (const options of [{ failInitialize: true }, { noSchema: true }, { rpcInitializeError: true }]) {
      const saved = await saveConnectedMcp(db, "owner", input, fakeMcp(options));
      assert.equal(saved.ok, true);
      if (!saved.ok) continue;
      const row = saved.servers.find((server) => server.id === saved.savedId)!;
      assert.equal(row.state, "failed");
      assert.ok(row.error);
      assert.equal((await listConnectedMcp(memoryDb(db.rows), "owner")).find((server) => server.id === row.id)?.state, "failed");
    }
  });

  it("does not resurrect an imported legacy row after deletion, fresh loads, or later saves", async () => {
    const owner = "legacy-owner";
    const file = join(directory, `${createHash("sha256").update(owner).digest("hex")}.json`);
    const original = JSON.stringify({ servers: [{ id: "old-connection", label: "Old", url: "http://localhost/mcp", token: TOKEN, ownerId: owner, state: "connected", tools: [{ name: "lookup" }], error: "" }] });
    writeFileSync(file, original);
    const db = memoryDb();
    const imported = await listConnectedMcp(db, owner);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].state, "failed", "legacy name-only tools are not schema-ready");
    assert.deepEqual(await removeConnectedMcp(db, owner, "old-connection"), []);
    resetRegistryStoreForTests();
    setConnectedLegacyDirectory(directory);
    const fresh = memoryDb(db.rows);
    assert.deepEqual(await listConnectedMcp(fresh, owner), []);
    const later = await saveConnectedMcp(fresh, owner, input, fakeMcp());
    assert.equal(later.ok, true);
    const loaded = await loadRegistry(owner, fresh);
    assert.equal((await saveRegistry(owner, loaded.servers, fresh)).ok, true);
    assert.equal((await listCustomConnections(memoryDb(db.rows), owner)).some((row) => row.id === "old-connection"), false);
    assert.equal((await listRegistryServers(owner, memoryDb(db.rows))).some((row) => row.id === "old-connection"), false);
    const marker = JSON.parse(db.rows.find((row) => row.id === "old-connection")!.record);
    assert.equal(marker.deleted, true);
    assert.equal(marker.tokenEnc, undefined);
    assert.equal(marker.token, undefined);
    assert.equal(readFileSync(file, "utf8"), original);
    assert.equal(existsSync(file), true);
    const wire = fakeMcp();
    const called = await callRegistryTool({ userId: owner, serverId: "old-connection", tool: "lookup", registryDb: fresh, fetch: wire.fetch, getSql: async () => { throw new Error("No SQL tools in this test"); } });
    assert.equal(called.ok, false);
    assert.match(called.text, /not registered/);
    assert.equal(wire.calls.length, 0);
  });

  it("durable chat sees saved rows across fresh loads and enforces confirmation and schemas without generic text", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const saved = await saveConnectedMcp(db, "owner", input, wire);
    resetRegistryStoreForTests();
    setConnectedLegacyDirectory(directory);
    const approval = { id: undefined as string | undefined };
    const turn = (text: string, confirmed = false, userId = "owner") => runConnectedMcpTurn({ db: memoryDb(db.rows), userId, text, confirmed, approvalId: approval.id, approvalServerId: confirmed && saved.ok ? saved.savedId : undefined, ...wire });
    wire.calls.length = 0;
    const listed = await turn("list MCP tools");
    assert.equal(listed.ok, true);
    assert.match(listed.text, /Connected: lookup/);
    assert.equal((await turn("list MCP tools", false, "stranger")).ok, false);
    const unconfirmed = await turn('call MCP tool lookup {"id":"42"}');
    assert.equal(unconfirmed.needsConfirmation, true);
    approval.id = unconfirmed.approvalId;
    assert.equal(wire.calls.length, 0);
    assert.equal((await turn("call MCP tool lookup arbitrary words", true)).ok, false);
    assert.equal((await turn('call MCP tool lookup {"text":"not a schema field"}', true)).ok, false);
    assert.equal(wire.calls.length, 0);
    const called = await turn('call MCP tool lookup {"id":"42"}', true);
    assert.equal(called.ok, true);
    assert.equal(called.text, "found");
    assert.equal((await turn('call MCP tool lookup {"id":"42"}', true)).ok, false);
    assert.deepEqual(wire.calls.find((call) => call.method === "tools/call")?.params?.arguments, { id: "42" });
    assert.ok(!JSON.stringify(called).includes(TOKEN));
  });

  it("keeps a reviewed call on the selected server after removal", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const first = await saveConnectedMcp(db, "owner", input, wire);
    const second = await saveConnectedMcp(db, "owner", { ...input, label: "Other" }, wire);
    assert.ok(first.ok && second.ok);
    const text = `call MCP tool lookup on server ${first.savedId} {"id":"42"}`;
    const request = { db, userId: "owner", text, confirmed: false, ...wire };
    const proposal = await runConnectedMcpTurn(request);
    assert.equal(proposal.approvalServerId, first.savedId);
    await removeConnectedMcp(db, "owner", first.savedId);
    wire.calls.length = 0;
    const result = await runConnectedMcpTurn({ ...request, confirmed: true, approvalServerId: proposal.approvalServerId, approvalId: proposal.approvalId });
    assert.equal(result.ok, false);
    assert.equal(wire.calls.length, 0);
  });

  it("blocks save/chat while halted and does not call disabled or deleted durable rows", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const stopped = { ...wire, isHalted: () => true };
    assert.equal((await saveConnectedMcp(db, "owner", input, stopped)).ok, false);
    assert.equal(db.rows.length, 0);
    const saved = await saveConnectedMcp(db, "owner", input, wire);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    wire.calls.length = 0;
    const turnInput = { db, userId: "owner", text: 'call MCP tool lookup {"id":"42"}', confirmed: true, ...wire };
    assert.equal((await runConnectedMcpTurn({ ...turnInput, isHalted: () => true })).ok, false);
    const loaded = await loadRegistry("owner", db);
    loaded.servers.find((server) => server.id === saved.savedId)!.enabled = false;
    await saveRegistry("owner", loaded.servers, db);
    assert.equal((await runConnectedMcpTurn(turnInput)).ok, false);
    await removeConnectedMcp(db, "owner", saved.savedId);
    assert.equal((await runConnectedMcpTurn(turnInput)).ok, false);
    assert.equal(wire.calls.length, 0);
  });
  it("invalidates reviewed capabilities when the remote schema changes and provides a complete review", async () => {
    const db = memoryDb();
    const base = fakeMcp();
    let revision = 1;
    const wire = { ...base, fetch: async (url: string, init?: RequestInit) => {
      const message = JSON.parse(String(init?.body));
      if (message.method !== "tools/list") return base.fetch(url, init);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ ...operation, description: revision === 1 ? "Read an item" : "Update an item" }] } }) };
    } };
    const saved = await saveConnectedMcp(db, "owner", input, wire);
    assert.ok(saved.ok);
    const text = 'call MCP tool lookup {"id":"42"}';
    const proposal = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: false, ...wire });
    assert.deepEqual(proposal.approval?.args, { id: "42" });
    assert.equal(proposal.approval?.host, "localhost");
    assert.equal(proposal.approval?.accountId, "owner");
    revision = 2;
    const stale = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: proposal.approvalId, approvalServerId: saved.savedId, ...wire });
    assert.equal(stale.ok, false);
    assert.match(stale.error, /definition changed/);
    assert.equal(base.calls.filter((call) => call.method === "tools/call").length, 0);
    const reviewed = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: false, ...wire });
    assert.notEqual(reviewed.approval?.capabilityRevision, proposal.approval?.capabilityRevision);
    const called = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: reviewed.approvalId, approvalServerId: saved.savedId, ...wire });
    assert.equal(called.ok, true);
    assert.equal(base.calls.filter((call) => call.method === "tools/call").length, 1);
  });

  it("fresh registry discovery updates the same definitions used by custom forms and chat", async () => {
    const db = memoryDb();
    const base = fakeMcp();
    let description = "First definition";
    const wire = { ...base, fetch: async (url: string, init?: RequestInit) => {
      const message = JSON.parse(String(init?.body));
      if (message.method !== "tools/list") return base.fetch(url, init);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ ...operation, description }] } }) };
    } };
    const saved = await saveConnectedMcp(db, "owner", input, wire);
    assert.ok(saved.ok);
    const before = (await listCustomConnections(db, "owner"))[0];
    description = "Current definition";
    const listed = await listRegistryTools("owner", wire.fetch, { registryDb: db, isHalted: () => false });
    assert.equal(listed.find((tool) => tool.serverId === saved.savedId)?.description, description);
    const after = (await listCustomConnections(db, "owner"))[0];
    assert.equal(after.operations[0].description, description);
    assert.notEqual(after.capabilityRevision, before.capabilityRevision);
    assert.equal((await listConnectedMcp(db, "owner"))[0].tools[0].description, description);
    assert.equal(base.calls.filter((call) => call.method === "tools/call").length, 0);
  });

  it("late MCP discovery cannot resurrect removal or overwrite changed credentials", async () => {
    for (const change of ["remove", "replace"] as const) {
      const db = memoryDb();
      const base = fakeMcp();
      const saved = await saveConnectedMcp(db, "owner", input, base);
      assert.ok(saved.ok);
      let release!: () => void;
      let reached!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { reached = resolve; });
      const refreshing = refreshMcp(db, "owner", saved.savedId, { fetch: async (url, init) => {
        if (JSON.parse(String(init?.body)).method === "tools/list") { reached(); await blocked; }
        return base.fetch(url, init);
      } });
      await started;
      if (change === "remove") await removeConnectedMcp(db, "owner", saved.savedId);
      else {
        const loaded = await loadRegistry("owner", db);
        const row = loaded.servers.find(item => item.id === saved.savedId)!;
        row.url = "http://localhost/replaced-mcp";
        row.enabled = false;
        await saveRegistry("owner", loaded.servers, db);
      }
      const afterChange = db.rows.find(item => item.id === saved.savedId)!.record;
      release();
      const result = await refreshing;
      assert.equal(result.state, "failed");
      assert.match(result.error ?? "", /changed or was removed/);
      assert.equal(db.rows.find(item => item.id === saved.savedId)!.record, afterChange);
      assert.equal(base.calls.filter(call => call.method === "tools/call").length, 0);
    }
  });

});
