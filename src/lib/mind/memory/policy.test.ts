import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sql } from "../../db.ts";
import { applyOwnerMemoryPolicy, assertOwnerMemoryDispatch, readOwnerMemoryPolicy, writeOwnerMemoryPolicy } from "./policy.server.ts";

function fixture() {
  const rows = new Map<string, { suspended: boolean; revision: number; updated_at: string }>();
  const calls: string[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?"); calls.push(query);
    if (query.startsWith("select")) return rows.has(String(values[0])) ? [rows.get(String(values[0]))] : [];
    if (query.startsWith("insert")) { const owner = String(values[0]); if (rows.has(owner)) return []; const row = { suspended: values[1] === true, revision: 1, updated_at: "2026-11-26T00:00:00Z" }; rows.set(owner, row); return [row]; }
    const owner = String(values[1]); const old = rows.get(owner); if (!old || old.revision !== values[2]) return []; const row = { ...old, suspended: values[0] === true, revision: old.revision + 1 }; rows.set(owner, row); return [row];
  }) as Sql;
  sql.query = async () => [];
  return { sql, rows, calls };
}

test("account memory suspension survives fresh reads and clears stale retry body context without deleting it", async () => {
  const { sql } = fixture();
  assert.deepEqual(await readOwnerMemoryPolicy("owner-a", sql), { suspended: false, revision: 0, updatedAt: null });
  assert.equal((await writeOwnerMemoryPolicy("owner-a", true, 0, sql)).ok, true);
  const original = { memory: "on", memoryContext: [{ id: "private", text: "private note" }], saveMemory: "auto-save", botKnowledge: "private bot", projectInstructions: "private project", knowledgePassages: [{ quote: "private document" }] };
  const result = await applyOwnerMemoryPolicy("owner-a", original, sql);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.effectiveMemory, "off"); assert.deepEqual(result.body.memoryContext, []);
  assert.equal(result.body.botKnowledge, ""); assert.equal(result.body.projectInstructions, ""); assert.deepEqual(result.body.knowledgePassages, []);
  assert.equal(original.memoryContext[0].text, "private note");
  assert.equal((await readOwnerMemoryPolicy("owner-b", sql)).suspended, false);
});

test("a stale second tab cannot undo a newer privacy change", async () => {
  const { sql } = fixture();
  await writeOwnerMemoryPolicy("owner", true, 0, sql);
  const stale = await writeOwnerMemoryPolicy("owner", false, 0, sql);
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.conflict, true);
  assert.equal((await readOwnerMemoryPolicy("owner", sql)).suspended, true);
  assert.equal((await writeOwnerMemoryPolicy("owner", false, 1, sql)).ok, true);
  assert.equal((await readOwnerMemoryPolicy("owner", sql)).suspended, false);
});

test("final dispatch rechecks a suspension changed after prompt preparation", async () => {
  const { sql } = fixture();
  assert.equal((await assertOwnerMemoryDispatch("owner", true, sql)).ok, true);
  await writeOwnerMemoryPolicy("owner", true, 0, sql);
  const stopped = await assertOwnerMemoryDispatch("owner", true, sql);
  assert.equal(stopped.ok, false); if (!stopped.ok) assert.match(stopped.error, /before dispatch/);
  assert.equal((await assertOwnerMemoryDispatch("owner", false, sql)).ok, true);
});

test("unavailable privacy storage fails closed without exposing driver details", async () => {
  const sql = (async () => { throw new Error("postgres://secret@host/password"); }) as unknown as Sql;
  const result = await assertOwnerMemoryDispatch("owner", true, sql);
  assert.equal(result.ok, false); if (!result.ok) { assert.match(result.error, /privacy could not be checked/); assert.doesNotMatch(result.error, /secret|password/); }
});
