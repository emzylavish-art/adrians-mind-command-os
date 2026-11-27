import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationSet } from "./migration-runner.mjs";

test("the previous workspace/provider SQL contract remains usable after additive C3 migrations and a candidate build failure", async () => {
  const folder = mkdtempSync(join(tmpdir(), "c3-migration-compatibility-"));
  const database = new PGlite(folder);
  try {
    await database.waitReady;
    const sources = Object.fromEntries(readdirSync("migrations").filter((name) => /^\d{4}_.+\.sql$/.test(name)).map((name) => [name, readFileSync(join("migrations", name), "utf8")]));
    const baseline = Object.fromEntries(Object.entries(sources).filter(([name]) => name.slice(0, 4) <= "0016"));
    const candidateMigrations = Object.keys(sources).filter((name) => name.slice(0, 4) > "0016").sort();
    await database.transaction((transaction) => applyMigrationSet(transaction, baseline));
    // Deliberately use the previous deployment's explicit column lists, without
    // importing the candidate application or relying on its new schema fields.
    const oldWrite = async (title) => database.transaction(async (transaction) => {
      const payload = JSON.stringify({ version: 1, chats: [{ id: "chat", title, messages: [{ id: "message", role: "user", content: "Preserved owner note" }] }] });
      await transaction.query("insert into mind_snapshot (user_id,payload,updated_at) values ($1,$2::jsonb,now()) on conflict(user_id) do update set payload=excluded.payload,updated_at=now()", ["owner", payload]);
      await transaction.query("insert into mind_chat (user_id,id,project_id,title,memory,autonomy,temporary,messages,retrieval_log) values ($1,$2,null,$3,'off','ask',false,$4::jsonb,'[]'::jsonb) on conflict(user_id,id) do update set title=excluded.title,messages=excluded.messages", ["owner", "chat", title, JSON.stringify([{ id: "message", role: "user", content: "Preserved owner note" }])]);
      await transaction.query("insert into mind_control (user_id,halted,updated_at) values ($1,false,now()) on conflict(user_id) do update set halted=excluded.halted", ["owner"]);
    });
    const oldProviderInsert = (id) => database.query("insert into mind_ai_providers (user_id,id,label,base_url,key_ciphertext,default_model,models,status,last_error) values ($1,$2,'Fixture API','https://provider.invalid','synthetic-encrypted-placeholder','fixture-model','[]'::jsonb,'configured','')", ["owner", id]);
    await oldWrite("Before candidate"); await oldProviderInsert("provider-before");
    const migrated = await database.transaction((transaction) => applyMigrationSet(transaction, sources));
    assert.deepEqual(migrated.applied, candidateMigrations);
    assert.ok(candidateMigrations.includes("0017_c3_provider_readiness.sql"));
    await assert.rejects(async () => { throw new Error("Synthetic candidate bundle verification failed; previous deployment remains selected."); }, /candidate bundle verification failed/);
    await oldWrite("Previous application still saving"); await oldProviderInsert("provider-after");
    const chat = await database.query("select title,messages,memory from mind_chat where user_id=$1 and id=$2", ["owner", "chat"]);
    assert.equal(chat.rows[0].title, "Previous application still saving"); assert.equal(chat.rows[0].messages[0].content, "Preserved owner note");
    const snapshot = await database.query("select payload from mind_snapshot where user_id=$1", ["owner"]);
    assert.equal(snapshot.rows[0].payload.chats[0].title, "Previous application still saving");
    assert.equal((await database.query("select payload from mind_snapshot where user_id=$1", ["other-owner"])).rows.length, 0);
    const providers = await database.query("select id,default_model,inference_model,model_capabilities from mind_ai_providers where user_id=$1 order by id", ["owner"]);
    assert.equal(providers.rows.length, 2); assert.ok(providers.rows.every((row) => row.default_model === "fixture-model" && row.inference_model === ""));
    assert.equal((await database.transaction((transaction) => applyMigrationSet(transaction, sources))).applied.length, 0);
  } finally {
    if (!database.closed) await database.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
