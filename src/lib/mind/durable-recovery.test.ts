import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { issueDurableExecution, recordDurableExecution } from "./execution-ledger.server.ts";
import { consumeSqlRateLimit } from "./rate-limit.server.ts";
import { sqlNotionOperationStore } from "./notion-operation-store.ts";

type Driver = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
function client(driver: Driver, transaction?: Sql["transaction"]): Sql {
  const sql = (async (parts: TemplateStringsArray, ...values: unknown[]) => {
    let text = parts[0]; for (let i = 0; i < values.length; i++) text += `$${i + 1}${parts[i + 1]}`;
    return (await driver.query(text, values)).rows;
  }) as Sql;
  sql.query = async <T>(text: string, values?: unknown[]) => (await driver.query(text, values)).rows as T[];
  sql.transaction = transaction;
  return sql;
}

test("durable recovery survives independent clients, rollback and concurrent retries", async () => {
  const db = new PGlite({ initialMemory: 128 * 1024 * 1024, postgresqlconf: ["shared_buffers=8MB", "work_mem=1MB"] });
  try {
    await db.exec(readFileSync(new URL("../../../migrations/0004_tool_run.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../../migrations/0007_oauth_connections.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../../migrations/0018_c2_execution_recovery.sql", import.meta.url), "utf8"));
    const freshClient = () => client(db, (fn) => db.transaction((tx) => fn(client(tx))));
    const issuer = freshClient();
    const id = await issueDurableExecution(issuer, "owner", { tool: "notion", action: "chat", ok: true, detail: "accepted" }, 1_000);
    assert.equal((await recordDurableExecution(freshClient(), "other", id, 1_001)).ok, false);
    const failing = freshClient();
    failing.transaction = (fn) => db.transaction(async (tx) => {
      const wrapped = client(tx);
      const original = wrapped.query;
      wrapped.query = async <T>(text: string, values?: unknown[]) => {
        if (text.startsWith("UPDATE mind_execution_receipt")) throw new Error("fixture storage loss after insert");
        return original<T>(text, values);
      };
      return fn(wrapped);
    });
    assert.equal((await recordDurableExecution(failing, "owner", id, 1_002)).ok, false);
    assert.equal((await db.query("SELECT * FROM mind_tool_run")).rows.length, 0);
    assert.equal((await recordDurableExecution(freshClient(), "owner", id, 1_003)).ok, true);
    assert.equal((await recordDurableExecution(freshClient(), "owner", id, 1_004)).ok, true);
    assert.equal((await db.query("SELECT * FROM mind_tool_run")).rows.length, 1);

    const results = await Promise.all(Array.from({ length: 8 }, () => consumeSqlRateLimit(freshClient(), "chat", "owner", 3, 60_000, 1_000)));
    assert.equal(results.filter((result) => result.ok).length, 3);
    assert.equal((await consumeSqlRateLimit(freshClient(), "chat", "other", 3, 60_000, 1_000)).ok, true);
    assert.equal((await consumeSqlRateLimit(freshClient(), "chat", "owner", 3, 60_000, 61_000)).ok, true);

    const operation = { id: "operation-1", workspaceId: "workspace-A", fingerprint: "note-and-page-hash", page: { id: "p1", title: "Roadmap", url: "https://www.notion.so/p1", kind: "page" as const }, state: "prepared" as const, blockIds: [] };
    await sqlNotionOperationStore(issuer, "owner").prepare(operation);
    const claims = await Promise.all([sqlNotionOperationStore(freshClient(), "owner").claim(operation.id, operation.fingerprint), sqlNotionOperationStore(freshClient(), "owner").claim(operation.id, operation.fingerprint)]);
    assert.deepEqual(claims.sort(), [false, true]);
    assert.equal(await sqlNotionOperationStore(freshClient(), "other").read(operation.id), null);
    await sqlNotionOperationStore(freshClient(), "owner").finish(operation.id, "accepted", ["new-block"]);
    const restored = await sqlNotionOperationStore(freshClient(), "owner").read(operation.id);
    assert.equal(restored?.state, "accepted");
    assert.deepEqual(restored?.blockIds, ["new-block"]);
  } finally { await db.close(); }
});
