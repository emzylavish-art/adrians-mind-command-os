import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { managedBrowserAction } from "./managed-browser.ts";
import { configuredManagedBrowser, managedBrowserReceipts, runManagedBrowserAction, savedManagedBrowser } from "./managed-browser.server.ts";

function sqlAdapter(db: PGlite | Transaction): Sql {
  const query = async <T>(text: string, params?: unknown[]) => (await db.query<T>(text, params)).rows;
  const sql = (async <T>(strings: TemplateStringsArray, ...params: unknown[]) =>
    query<T>(strings.reduce((text, part, index) => text + (index ? "$" + index : "") + part, ""), params)) as Sql;
  sql.query = query;
  if (db instanceof PGlite) sql.transaction = fn => db.transaction(tx => fn(sqlAdapter(tx)));
  return sql;
}

test("managed browser accepts approved HTTPS origins and validates manual input", () => {
  assert.deepEqual(managedBrowserAction({ kind: "start", origin: "https://example.com/" }), { kind: "start", origin: "https://example.com" });
  for (const origin of ["http://example.com", "https://host.local", "https://127.0.0.1", "https://example.com/#secret", "https://example.com/path", "https://user@example.com"]) {
    assert.equal(managedBrowserAction({ kind: "start", origin }), null);
  }
  assert.equal(managedBrowserAction({ kind: "click", x: -1, y: 1 }), null);
  assert.equal(managedBrowserAction({ kind: "key", key: "Control+a" }), null);
  assert.equal(managedBrowserAction({ kind: "text", text: "a".repeat(301) }), null);
  assert.equal(configuredManagedBrowser({ ADRIAN_MANAGED_BROWSER_URL: "http://admin.invalid" }), null);
});

test("managed browser records single claims, rejects foreign owners and recovers unknown outcomes by status", async () => {
  const db = await PGlite.create();
  try {
    for (const name of ["0001_auth.sql", "0002_mind.sql", "0028_managed_browser.sql"]) {
      await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
    }
    const sql = sqlAdapter(db);
    for (const user of ["owner-a", "owner-b"]) {
      await sql.query('insert into "user"(id,name,email,"emailVerified") values($1,$1,$2,true)', [user, user + "@example.invalid"]);
    }
    const origin = "https://example.com";
    let attempts = 0;
    const [first, second] = await Promise.all([
      runManagedBrowserAction(sql, "owner-a", null, { kind: "start", origin }, async () => { attempts++; return {}; }),
      runManagedBrowserAction(sql, "owner-a", null, { kind: "start", origin }, async () => { attempts++; return {}; }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [409, 503]);
    assert.equal(attempts, 1);
    const session = await savedManagedBrowser(sql, "owner-a");
    assert.equal(session?.mode, "unconfirmed");
    assert.equal(await savedManagedBrowser(sql, "owner-b"), null);
    assert.deepEqual(await managedBrowserReceipts(sql, "owner-b", session!.id), []);
    const refused = await runManagedBrowserAction(sql, "owner-b", session!.id, { kind: "stop" }, async () => { throw Error("foreign dispatch"); });
    assert.equal(refused.status, 409);
    const checked = await runManagedBrowserAction(sql, "owner-a", session!.id, { kind: "status" }, async () => ({ reply: { mode: "managed" } }));
    assert.equal(checked.session?.mode, "managed");
    await sql.query("update mind_control set halted=true where user_id=$1", ["owner-a"]);
    const halted = await runManagedBrowserAction(sql, "owner-a", session!.id, { kind: "takeover" }, async () => { throw Error("halted dispatch"); });
    assert.equal(halted.status, 409);
    const stopped = await runManagedBrowserAction(sql, "owner-a", session!.id, { kind: "stop" }, async () => ({ reply: { mode: "stopped" } }));
    assert.equal(stopped.session?.mode, "stopped");
    const receipts = await managedBrowserReceipts(sql, "owner-a", session!.id);
    assert.deepEqual(receipts.map(row => [row.action, row.outcome]), [["stop", "confirmed"], ["status", "confirmed"], ["start", "unconfirmed"]]);
  } finally { await db.close(); }
});
