import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { listCustomConnections, saveCustomConnection } from "./custom-connection.ts";
import { listRegistryServers } from "./mcp/registry.ts";
import { decryptSecret } from "./connectors/crypto.ts";
import { resetRegistryStoreForTests, setConnectedLegacyDirectory, type RegistryDb } from "./mcp/registry-store.ts";

const SECRET = "test-connector-secret";
type Row = { user_id: string; id: string; record: string };

function memoryDb(rows: Row[]): RegistryDb & { rows: Row[] } {
  return {
    rows,
    async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
      const userId = String(params[0] ?? "");
      if (text.startsWith("select record")) return rows.filter((row) => row.user_id === userId).map((row) => ({ record: row.record })) as T[];
      if (text.startsWith("select id")) return rows.filter((row) => row.user_id === userId).map((row) => ({ id: row.id })) as T[];
      if (text.startsWith("delete")) {
        const index = rows.findIndex((row) => row.user_id === userId && row.id === String(params[1] ?? ""));
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
      }
      return [] as T[];
    },
  };
}

describe("Tools custom connection UI path", { concurrency: false }, () => {
  it("discovers a schema, refuses a generic text call, and returns the result line the form renders", async () => {
    resetRegistryStoreForTests();
    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const db = memoryDb([]);
    const saved = await saveCustomConnection(db, "owner", {
      label: "Status",
      kind: "http",
      url: "https://mcp.example/status",
      method: "GET",
      fields: ["id"],
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const listed = await listCustomConnections(db, "owner");
    const row = listed.find((item) => item.id === saved.connection.id);
    assert.equal(row?.operations[0]?.name, "request");
    assert.equal(row?.operations[0]?.inputSchema?.required[0], "id");
    assert.equal(row?.operations[0]?.compatible, true);
    const form = readFileSync(new URL("../../components/mind/custom-connections.tsx", import.meta.url), "utf8");
    assert.match(form, /Result \(\{result\.status\}\): \{result\.text\}/);
    assert.match(form, /saved\.error/);
    assert.match(form, /operation\.compatible \? "schema" : "incompatible"/);
    assert.doesNotMatch(form, /failure-banner|mcp-call-action/);
    delete process.env.CONNECTOR_TOKEN_SECRET;
    resetRegistryStoreForTests();
  });

  it("reads a Connected-form legacy file into the registry only when the secret can seal it", async () => {
    resetRegistryStoreForTests();
    const dir = mkdtempSync(join(tmpdir(), "mind-mcp-connected-"));
    const userId = "connected-owner";
    const file = join(dir, `${createHash("sha256").update(userId).digest("hex")}.json`);
    const original = JSON.stringify({
      servers: [{ id: "saved-1", label: "Old", host: "mcp.example", url: "https://mcp.example/mcp", token: "file-token", ownerId: userId, state: "unchecked", tools: [], error: "" }],
    });
    writeFileSync(file, original);
    setConnectedLegacyDirectory(dir);
    delete process.env.CONNECTOR_TOKEN_SECRET;
    const blocked = memoryDb([]);
    const hidden = await listRegistryServers(userId, blocked);
    assert.equal(hidden.some((server) => server.id === "saved-1"), true);
    assert.equal(JSON.stringify(hidden).includes("file-token"), false);
    assert.equal(blocked.rows.length, 0);
    assert.equal(readFileSync(file, "utf8"), original);

    process.env.CONNECTOR_TOKEN_SECRET = SECRET;
    const db = memoryDb([]);
    const imported = await listRegistryServers(userId, db);
    assert.equal(imported.some((server) => server.id === "saved-1" && server.hasToken), true);
    const record = JSON.parse(db.rows.find((row) => row.id === "saved-1")?.record ?? "{}") as { token?: string; tokenEnc?: string };
    assert.equal(record.token, undefined);
    assert.equal(decryptSecret(record.tokenEnc ?? ""), "file-token");
    assert.equal(readFileSync(file, "utf8"), original);
    delete process.env.CONNECTOR_TOKEN_SECRET;
    resetRegistryStoreForTests();
  });

  it("keeps the Tools mount and leaves the Logic-owned Connected handlers in place", () => {
    const fleet = readFileSync(new URL("../../components/mind/fleet-panels.tsx", import.meta.url), "utf8");
    const command = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
    const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    assert.match(fleet, /<CustomConnections/);
    assert.match(command, /mcpSave\(/);
    assert.match(server, /saveMcp\(context\.userId, data\)/);
    assert.doesNotMatch(server, /saveMcp\(context\.userId, data, db\)/);
  });

  it("keeps the client off the server-only module and checks halt before a custom call", () => {
    const custom = readFileSync(new URL("../../components/mind/custom-connections.tsx", import.meta.url), "utf8");
    const fns = readFileSync(new URL("./custom-connection-fns.ts", import.meta.url), "utf8");
    const stdio = readFileSync(new URL("./mcp/stdio.ts", import.meta.url), "utf8");
    assert.match(custom, /custom-connection-fns/);
    assert.doesNotMatch(custom, /custom-connection\.server/);
    const callAt = fns.indexOf("export const callCustomConnectionFn");
    const haltAt = fns.indexOf("haltIsOn", callAt);
    const invokeAt = fns.indexOf("callCustomConnection(", callAt);
    assert.ok(callAt >= 0 && haltAt > callAt && invokeAt > haltAt);
    assert.match(stdio, /import \{ isBlockedChildEnvKey \} from "\.\/stdio-policy\.ts"/);
  });
});
