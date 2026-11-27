import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { emptyWorkspace, normalizeWorkspace } from "./workspace.ts";
import { readSnapshot, writeSnapshot } from "./store.ts";
import { getAccountAttachment, putAccountAttachment } from "./media/account-attachments.server.ts";
import { readModelExecutions, saveModelExecution } from "./model-execution.server.ts";
import type { ConsultExecutionReceipt } from "./model-consult.ts";

it("C4 incremental snapshots retain owner isolation, CAS and atomic rollback", async () => {
  const db = new PGlite();
  await db.waitReady;
  for (const path of ["migrations/0002_mind.sql", "migrations/0003_fleet.sql", "migrations/0017_c4_account_attachments.sql", "migrations/0018_c4_model_execution_receipts.sql"]) await db.exec(readFileSync(path, "utf8"));
  const statements: string[] = [];
  let failSnapshot = false;
  const wrap = (client: Pick<PGlite, "query">): Sql => {
    const query = async <T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> => {
      statements.push(text);
      if (failSnapshot && text.includes("set payload = excluded.payload")) throw new Error("synthetic snapshot failure");
      return (await client.query<T>(text, values)).rows;
    };
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0];
      for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
      return query(text, values);
    }) as Sql;
    sql.query = query;
    return sql;
  };
  const sql = wrap(db);
  sql.transaction = (fn) => db.transaction((tx) => fn(wrap(tx)));
  try {
    const base = emptyWorkspace();
    base.projects = [{ id: "project", name: "Keep", description: "", createdAt: "2026-01-01T00:00:00.000Z" }];
    base.chats = [{ id: "chat", title: "Before", memory: "off", temporary: false, autonomy: "ask", projectId: null, messages: [], retrievalLog: [] }];
    const revision = await writeSnapshot(sql, "a", base);
    await writeSnapshot(sql, "b", base);
    const changed = structuredClone(base); changed.chats[0].title = "After";
    statements.length = 0;
    const nextRevision = await writeSnapshot(sql, "a", changed, revision!);
    assert.equal(statements.some((text) => text.includes("mind_project")), false);
    assert.equal(statements.filter((text) => text.startsWith("insert into mind_chat")).length, 1);
    assert.equal(statements.some((text) => /^delete/.test(text)), false);
    assert.equal(normalizeWorkspace(await readSnapshot(sql, "b")).chats[0].title, "Before");
    assert.equal(await writeSnapshot(sql, "a", base, revision!), null);
    failSnapshot = true;
    const failed = structuredClone(changed); failed.chats[0].title = "Must roll back";
    await assert.rejects(writeSnapshot(sql, "a", failed, nextRevision!), /synthetic/);
    failSnapshot = false;
    assert.equal((await db.query<{ title: string }>("select title from mind_chat where user_id = 'a'")).rows[0].title, "After");
    assert.equal(normalizeWorkspace(await readSnapshot(sql, "a")).chats[0].title, "After");
    const deleted = { ...changed, projects: [] };
    await writeSnapshot(sql, "a", deleted, nextRevision!);
    assert.equal((await db.query("select * from mind_project where user_id = 'a'")).rows.length, 0);
    assert.equal((await db.query("select * from mind_project where user_id = 'b'")).rows.length, 1);
    const image = "data:image/png;base64,YQ==";
    const receipt = await putAccountAttachment(sql, "a", image);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(await getAccountAttachment(sql, "a", receipt.id), image);
    assert.equal(await getAccountAttachment(sql, "b", receipt.id), undefined);
    assert.deepEqual(await putAccountAttachment(sql, "a", image), receipt);
    assert.equal((await db.query("select * from mind_account_attachment")).rows.length, 1);
    const execution: ConsultExecutionReceipt = { executionId: "parent:helper:0", parentOperationId: "parent", role: "helper",
      provider: "gemini", model: "actual", requestedModel: "selected", requestId: "request", usage: { prompt_tokens: 12 }, executionLocation: "hosted", outcome: "completed" };
    await saveModelExecution(sql, "a", execution);
    await saveModelExecution(sql, "a", execution);
    await saveModelExecution(sql, "a", { ...execution, outcome: "unknown", usage: null });
    assert.deepEqual(await readModelExecutions(sql, "a", "parent"), [execution]);
    assert.deepEqual(await readModelExecutions(sql, "b", "parent"), []);
  } finally { await db.close(); }
});
