import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
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
  await call("user-a", { operation: "write", path: "private.txt", content: "A only" });
  assert.equal((await call("user-b", { operation: "read", path: "private.txt" })).status, 404);
  assert.deepEqual((await (await call("user-b", { operation: "search", query: "A only" })).json()).matches, []);
  assert.equal((await (await call("user-b", { operation: "list" })).json()).total, 1);
  assert.equal((await call("user-a", { operation: "write", path: "notes.txt", expectedContent: "stale", content: "replacement" })).status, 409);
  assert.equal((await call("user-a", { operation: "write", path: "notes.txt", expectedMissing: true, content: "replacement" })).status, 409);
  assert.equal((await call("user-a", { operation: "write", path: "notes.txt", expectedContent: "user-a", content: "changed" })).status, 200);
  assert.equal((await call("user-a", { operation: "rename", path: "notes.txt", to: "private.txt", confirm: true })).status, 409);
  assert.equal((await call("user-a", { operation: "rename", path: "notes.txt", to: "moved.txt", confirm: true })).status, 200);
  assert.equal((await call("user-b", { operation: "delete", path: "moved.txt", confirm: true })).status, 404);
  assert.equal((await call("user-a", { operation: "delete", path: "moved.txt", confirm: true })).status, 200);
  assert.equal((await (await call("user-b", { operation: "read", path: "notes.txt" })).json()).result.content, "user-b");
  for (const operation of ["git", "checkpoints", "restore"]) assert.equal((await call("user-b", { operation })).status, 409);
});
