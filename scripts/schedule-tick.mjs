#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";
import { runWorkerPass } from "../src/lib/mind/worker-pass.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, ".data", "pglite");
const now = new Date().toISOString();

function toSql(pg) {
  const sql = async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`;
    const result = await pg.query(text, values);
    return result.rows;
  };
  sql.query = async (text, params = []) => (await pg.query(text, params)).rows;
  return sql;
}

try {
  mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite({ dataDir });
  await pg.waitReady;
  await pg.exec("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const names = await readdir(join(root, "migrations"));
  const files = {};
  for (const name of names) {
    if (name.endsWith(".sql")) files[name] = await readFile(join(root, "migrations", name), "utf8");
  }
  const done = (await pg.query("select name from _migrations")).rows.map((row) => row.name);
  for (const { name, path } of pendingMigrations(Object.keys(files), done)) {
    await pg.exec("begin");
    await pg.exec(files[path] ?? files[name]);
    await pg.query("insert into _migrations (name) values ($1)", [name]);
    await pg.exec("commit");
  }
  const result = await runWorkerPass(toSql(pg), now, `worker-${process.pid}`, new Map());
  await pg.close();
  const report = { at: now, heartbeatAt: now, running: false, mode: "one-shot", ...result, hosted: false, localOnly: true, note: "One pass against the file database on this machine. This process then exits. It is not a hosted always-on worker." };
  mkdirSync(join(root, ".data"), { recursive: true });
  writeFileSync(join(root, ".data", "worker-status.json"), JSON.stringify(report));
  console.log(`Worker pass finished. Owners ${result.owners}. Schedule triggers ${result.ran}. Agent passes ${result.agentPasses}. Skipped ${result.skipped}. Failed ${result.failed}. This process exits after one pass. It is not a hosted always-on worker.`);
} catch (error) {
  const message = error instanceof Error ? error.message : "The database could not be opened.";
  console.log(`Worker pass did not run. ${message} No job was executed.`);
  process.exit(1);
}
