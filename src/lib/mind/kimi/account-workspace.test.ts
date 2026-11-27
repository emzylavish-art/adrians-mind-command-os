import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { reconcileStoredMutation } from "./file-reconciliation.ts";
import { fileRevision } from "./file-revision.ts";
import { accountFileOperation } from "./account-workspace.ts";
import type { Sql } from "../../db.ts";

test("two signed-in owners with identical file names have independent read, search, edit, and delete results", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL("../../../../migrations/0009_kimi_files.sql", import.meta.url), "utf8"));
  const adapter = (driver: Pick<PGlite, "query">) => ({
    query: async <T>(text: string, params: unknown[]) => (await driver.query<T>(text, params)).rows,
  } as Sql);
  const sql = adapter(db);
  sql.transaction = (fn) => db.transaction((tx) => fn(adapter(tx)));
  const call = (owner: string, body: Parameters<typeof accountFileOperation>[2]) => accountFileOperation(sql, owner, body);
  for (const owner of ["user-a", "user-b"]) {
    assert.equal((await call(owner, { operation: "write", path: "notes.txt", content: owner, expectedMissing: true })).status, 200);
  }
  await call("user-a", { operation: "write", path: "private.txt", content: "A only", expectedMissing: true });
  assert.equal((await call("user-b", { operation: "read", path: "private.txt" })).status, 404);
  assert.deepEqual((await (await call("user-b", { operation: "search", query: "A only" })).json()).matches, []);
  assert.equal((await (await call("user-b", { operation: "list" })).json()).total, 1);
  assert.equal((await call("user-a", { operation: "write", path: "notes.txt", expectedContent: "stale", content: "replacement" })).status, 409);
  assert.equal((await call("user-a", { operation: "write", path: "notes.txt", expectedMissing: true, content: "replacement" })).status, 409);
  assert.equal((await call("user-a", { operation: "write", path: "notes.txt", expectedContent: "user-a", content: "changed" })).status, 200);
  for (const unsafe of [
    { operation: "write", path: "notes.txt", content: "blind overwrite" },
    { operation: "rename", path: "notes.txt", to: "lost.txt", confirm: true },
    { operation: "delete", path: "notes.txt", confirm: true },
    { operation: "rename", path: "notes.txt", to: "lost.txt", confirm: true, expectedRevision: fileRevision("user-a") },
    { operation: "delete", path: "notes.txt", confirm: true, expectedRevision: fileRevision("user-a") },
  ]) assert.equal((await call("user-a", unsafe)).status, 409);
  assert.equal((await (await call("user-a", { operation: "read", path: "notes.txt" })).json()).content, "changed");
  assert.equal((await call("user-a", { operation: "rename", path: "notes.txt", to: "private.txt", confirm: true, expectedRevision: fileRevision("changed") })).status, 409);
  assert.equal((await call("user-a", { operation: "rename", path: "notes.txt", to: "moved.txt", confirm: true, expectedRevision: fileRevision("changed") })).status, 200);
  assert.equal((await call("user-b", { operation: "delete", path: "moved.txt", confirm: true, expectedRevision: fileRevision("changed") })).status, 404);
  assert.equal((await call("user-a", { operation: "delete", path: "moved.txt", confirm: true, expectedRevision: fileRevision("changed") })).status, 200);
  assert.equal((await (await call("user-b", { operation: "read", path: "notes.txt" })).json()).result.content, "user-b");
  await call("user-a", { operation: "write", path: "recover.txt", content: "reviewed", expectedMissing: true });
  const reconcile = { action: "rename" as const, path: "recover.txt", to: "recovered.txt", expectedRevision: fileRevision("reviewed") };
  assert.equal((await reconcileStoredMutation(sql, "user-a", reconcile, () => false)).ok, false);
  assert.equal((await reconcileStoredMutation(sql, "user-a", { ...reconcile, expectedRevision: fileRevision("stale") }, () => true)).ok, false);
  assert.equal((await reconcileStoredMutation(sql, "user-a", reconcile, () => true)).ok, true);
  assert.equal((await reconcileStoredMutation(sql, "user-a", reconcile, () => true)).ok, true, "verified repeated reconciliation is harmless");
  assert.equal((await (await call("user-a", { operation: "read", path: "recovered.txt" })).json()).content, "reviewed");
  assert.equal((await reconcileStoredMutation(sql, "user-a", { action: "delete", path: "recovered.txt", expectedRevision: fileRevision("stale") }, () => true)).ok, false);
  assert.equal((await reconcileStoredMutation(sql, "user-a", { action: "delete", path: "recovered.txt", expectedRevision: fileRevision("reviewed") }, () => true)).ok, true);
  assert.equal((await call("user-a", { operation: "read", path: "recovered.txt" })).status, 404);
  await sql.query("insert into mind_kimi_file(user_id,path,text_copy,bytes) select $1, 'src/deep/file-' || lpad(n::text,4,'0') || '.ts', 'needle', 6 from generate_series(1,1105) as n", ["large-repo"]);
  let cursor: string | undefined;
  const all = new Set<string>();
  do {
    const page = await (await call("large-repo", { operation: "list", directory: "src/deep", ...(cursor ? { cursor } : {}) })).json();
    assert.equal(page.total, 1105);
    for (const file of page.files) { assert.equal(all.has(file.path), false); all.add(file.path); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(all.size, 1105);
  const searched = await (await call("large-repo", { operation: "search", query: "needle" })).json();
  assert.equal(searched.matches.length, 100);
  assert.equal(searched.total, 1105);
  const next = await (await call("large-repo", { operation: "search", query: "needle", cursor: searched.nextCursor })).json();
  assert.equal(next.matches[0].path, "src/deep/file-0101.ts");
  assert.equal((await (await call("large-repo", { operation: "list", directory: "src/missing" })).json()).total, 0);
  for (const operation of ["git", "checkpoints", "restore"]) assert.equal((await call("user-b", { operation })).status, 409);
});
