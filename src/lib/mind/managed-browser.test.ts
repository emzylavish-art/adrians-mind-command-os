import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "../db.ts";
import { managedBrowserRequest, stopOwnerManagedBrowser } from "./managed-browser.server.ts";
import { managedBrowserUrl, type BrowserInput, type ManagedBrowserSession } from "./managed-browser.ts";

function sqlAdapter(db: PGlite | Transaction): Sql {
  const sql = (() => { throw new Error("Use the query interface"); }) as unknown as Sql;
  sql.query = async <T>(text: string, params?: unknown[]) => (await db.query<T>(text, params)).rows;
  if (db instanceof PGlite) sql.transaction = fn => db.transaction(tx => fn(sqlAdapter(tx)));
  return sql;
}

test("managed navigation accepts only queryless public-looking HTTPS page addresses", () => {
  for (const url of ["http://fixture.example", "https://user:password@fixture.example", "https://127.0.0.1", "https://fixture.example:8443", "https://fixture.example/?token=value", "https://fixture.example/#section"]) {
    assert.equal(managedBrowserUrl(url), null);
  }
  assert.equal(managedBrowserUrl("https://fixture.example/guide")?.pathname, "/guide");
});

test("persists browser control per owner and recovers an unconfirmed handback without replay", async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  for (const name of ["0001_auth.sql", "0002_mind.sql", "0028_managed_browser.sql", "0029_managed_browser_controls.sql"]) {
    await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
  }
  const sql = sqlAdapter(db);
  const commands: { id: string; action: string }[] = [];
  const worker = async (id: string, input: BrowserInput) => {
    commands.push({ id, action: input.action });
    if (input.action === "handback") throw new Error("Lost worker reply");
    const phase = input.action === "stop" ? "closed" : input.action === "takeover" ? "manual" : "managed";
    return { phase, frame: { image: "/9j/AAAA", path: "/" } } as const;
  };
  const options = { origins: new Set(["https://fixture.example"]), worker, localHalt: async () => "off" as const };
  const id = randomUUID();
  const request = (owner: string, action: string, fields: object = {}) => managedBrowserRequest(sql, owner, { id, action, ...fields }, options);
  const state = (reply: Awaited<ReturnType<typeof request>>) => (reply.body as { session: ManagedBrowserSession }).session;
  assert.equal((await request("a", "start", { target: "https://fixture.example" })).status, 400);
  const start = { target: "https://fixture.example", approved: true };
  const first = state(await request("a", "start", start));
  assert.equal(first.phase, "managed");
  assert.equal((await request("b", "takeover", { revision: first.revision })).status, 404);
  const other = state(await request("b", "start", start));
  assert.equal(other.phase, "managed");
  assert.notEqual(commands[0].id, commands[1].id);
  assert.equal((await request("a", "takeover", { revision: first.revision - 1 })).status, 409);
  const manual = state(await request("a", "takeover", { revision: first.revision }));
  assert.equal(manual.phase, "manual");
  const uncertain = state(await request("a", "handback", { revision: manual.revision }));
  assert.equal(uncertain.phase, "uncertain");
  const reconciled = state(await request("a", "recover", { revision: uncertain.revision }));
  assert.equal(reconciled.phase, "managed");
  assert.equal(commands.filter(cmd => cmd.action === "handback").length, 1);
  await sql.query("update mind_control set halted=true where user_id=$1", ["a"]);
  assert.equal((await request("a", "frame", { revision: reconciled.revision })).status, 409);
  const closed = state(await request("a", "recover", { revision: reconciled.revision }));
  assert.equal(closed.phase, "closed");
  assert.equal(commands.at(-1)?.action, "stop");
  assert.equal(closed.receipts.length, 5);
  const listed = await request("b", "list");
  assert.deepEqual((listed.body as { sessions: ManagedBrowserSession[] }).sessions, [other]);
});

test("account halt revokes a reserved start and prevents its late acknowledgement overwriting closure", async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  for (const name of ["0001_auth.sql", "0002_mind.sql", "0028_managed_browser.sql", "0029_managed_browser_controls.sql"]) {
    await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
  }
  const sql = sqlAdapter(db);
  let markDispatched!: () => void;
  const dispatched = new Promise<void>(resolve => { markDispatched = resolve; });
  let markStarted!: (result: { phase: "managed" }) => void;
  const started = new Promise<{ phase: "managed" }>(resolve => { markStarted = resolve; });
  const seen: string[] = [];
  const options = {
    origins: new Set(["https://fixture.example"]), localHalt: async () => "off" as const,
    worker: async (_id: string, input: BrowserInput) => {
      seen.push(input.action);
      if (input.action === "start") {
        markDispatched();
        return started;
      }
      return { phase: "closed" as const };
    },
  };
  const id = randomUUID();
  const start = managedBrowserRequest(sql, "owner", {
    id, action: "start", approved: true, target: "https://fixture.example",
  }, options);
  await dispatched;
  await sql.query("update mind_control set halted=true where user_id=$1", ["owner"]);
  await stopOwnerManagedBrowser(sql, "owner", options);
  markStarted({ phase: "managed" });
  assert.equal((await start).status, 409);
  const { body } = await managedBrowserRequest(sql, "owner", { action: "list" }, options);
  const session = (body as { sessions: ManagedBrowserSession[] }).sessions[0];
  assert.equal(session.phase, "closed");
  assert.deepEqual(seen, ["start", "stop"]);
});

test("preserves the previous worker's receipts while leaving unfinished sessions uncertified", async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  for (const name of ["0001_auth.sql", "0002_mind.sql", "0028_managed_browser.sql"]) {
    await db.exec(await readFile(new URL("../../../migrations/" + name, import.meta.url), "utf8"));
  }
  const id = randomUUID();
  await db.query('insert into "user"(id,name,email,"emailVerified") values($1,$1,$2,true)', ["old-owner", "old@example.test"]);
  await db.query("insert into mind_managed_browser(id,user_id,origin,mode,operation) values($1,$2,$3,'takeover','takeover')",
    [id, "old-owner", "https://fixture.example"]);
  await db.query("insert into mind_managed_browser_receipt(id,session_id,action,outcome) values($1,$2,'takeover','confirmed')", [randomUUID(), id]);
  await db.exec(await readFile(new URL("../../../migrations/0029_managed_browser_controls.sql", import.meta.url), "utf8"));
  const [copied] = (await db.query<{ phase: string; receipts: { action: string }[] }>(
    "select phase,receipts from mind_managed_browser_control where user_id=$1 and session_id=$2", ["old-owner", id],
  )).rows;
  assert.equal(copied.phase, "uncertain");
  assert.equal(copied.receipts[0].action, "takeover");
});
