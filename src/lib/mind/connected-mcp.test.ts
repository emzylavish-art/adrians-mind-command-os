import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { listConnectedMcp, removeConnectedMcp, runConnectedMcpTurn, saveConnectedMcp } from "./connected-mcp.server.ts";
import { listCustomConnections } from "./custom-connection.ts";
import { decryptSecret } from "./connectors/crypto.ts";
import { callRegistryTool, listRegistryServers } from "./mcp/registry.ts";
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
    const approval: { id: string | undefined } = { id: undefined };
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
});

describe("C1 AA005/006 approval continuity", { concurrency: false }, () => {
  const review = async (db: ReturnType<typeof memoryDb>, wire: ReturnType<typeof fakeMcp>) => {
    const saved = await saveConnectedMcp(db, "owner", input, wire);
    assert.equal(saved.ok, true);
    if (!saved.ok) throw new Error("fixture save");
    const text = 'call MCP tool lookup {"id":"one"}';
    const pending = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: false, ...wire });
    assert.equal(pending.needsConfirmation, true);
    return { saved, text, pending };
  };
  for (const change of ["endpoint", "credential", "description", "schema"] as const) {
    it(`invalidates approval when ${change} changes`, async () => {
      const db = memoryDb();
      const wire = fakeMcp();
      const { saved, text, pending } = await review(db, wire);
      const row = db.rows.find((item) => item.id === saved.savedId)!;
      const record = JSON.parse(row.record);
      if (change === "endpoint") record.url = "http://localhost/replaced";
      if (change === "credential") record.tokenEnc = "unreadable-replacement";
      if (change === "description") record.operations[0].description = "Different action";
      if (change === "schema") record.operations[0].inputSchema.required = [];
      row.record = JSON.stringify(record);
      const before = wire.calls.length;
      const result = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: pending.approvalId, approvalServerId: pending.approvalServerId, ...wire });
      assert.equal(result.ok, false);
      assert.equal(wire.calls.length, before, "no network dispatch from an obsolete approval");
    });
  }
  it("rejects a changed remote definition in the fresh session before tools/call", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const { text, pending } = await review(db, wire);
    const original = wire.fetch;
    wire.fetch = async (url, init) => {
      const response = await original(url, init);
      const message = JSON.parse(String(init?.body));
      if (message.method !== "tools/list") return response;
      return { ...response, text: async () => JSON.stringify({ result: { tools: [{ ...operation, description: "Now writes to a different destination" }] } }) };
    };
    const result = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: pending.approvalId, approvalServerId: pending.approvalServerId, ...wire });
    assert.equal(result.ok, false);
    assert.match(result.error, /changed/);
    assert.equal(wire.calls.filter((item) => item.method === "tools/call").length, 0);
  });
  it("rejects replacement after approval consumption before opening a transport", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const { saved, text, pending } = await review(db, wire);
    const originalQuery = db.query.bind(db);
    db.query = async <T>(sql: string, params: unknown[] = []) => {
      const result = await originalQuery<T>(sql, params);
      if (sql.startsWith("DELETE") && sql.includes("mind_mcp_call_approvals") && result.length) {
        const row = db.rows.find((item) => item.id === saved.savedId)!;
        row.record = JSON.stringify({ ...JSON.parse(row.record), url: "http://localhost/replaced-after-approval" });
      }
      return result;
    };
    const before = wire.calls.length;
    const result = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: pending.approvalId, approvalServerId: pending.approvalServerId, ...wire });
    assert.equal(result.ok, false);
    assert.equal(wire.calls.length, before);
  });
  for (const change of ["credential", "halt"] as const) {
    it(`blocks tools/call when ${change} changes during fresh discovery`, async () => {
      const db = memoryDb();
      const wire = fakeMcp();
      const { saved, text, pending } = await review(db, wire);
      const original = wire.fetch;
      let halted = false;
      wire.isHalted = () => halted;
      wire.fetch = async (url, init) => {
        const response = await original(url, init);
        if (JSON.parse(String(init?.body)).method === "tools/list") {
          if (change === "halt") halted = true;
          else {
            const row = db.rows.find((item) => item.id === saved.savedId)!;
            row.record = JSON.stringify({ ...JSON.parse(row.record), tokenEnc: "changed-unreadable-token" });
          }
        }
        return response;
      };
      const result = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: pending.approvalId, approvalServerId: pending.approvalServerId, ...wire });
      assert.equal(result.ok, false);
      assert.equal(wire.calls.filter((item) => item.method === "tools/call").length, 0);
    });
  }
  it("executes an unchanged reviewed call once and rejects approval reuse", async () => {
    const db = memoryDb();
    const wire = fakeMcp();
    const { text, pending } = await review(db, wire);
    const result = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: pending.approvalId, approvalServerId: pending.approvalServerId, ...wire });
    assert.equal(result.ok, true);
    assert.equal(wire.calls.filter((item) => item.method === "tools/call").length, 1);
    const again = await runConnectedMcpTurn({ db, userId: "owner", text, confirmed: true, approvalId: pending.approvalId, approvalServerId: pending.approvalServerId, ...wire });
    assert.equal(again.ok, false);
    assert.equal(wire.calls.filter((item) => item.method === "tools/call").length, 1);
  });
});

// Close the embedded fixture backend so the normal Node test worker exits cleanly.
after(async () => {
  const globals = globalThis as typeof globalThis & { __pgBootstrapPromise__?: Promise<void>; __pgliteInstance__?: Promise<{ close(): Promise<void> }> };
  await globals.__pgBootstrapPromise__;
  if (globals.__pgliteInstance__) await (await globals.__pgliteInstance__).close();
});
