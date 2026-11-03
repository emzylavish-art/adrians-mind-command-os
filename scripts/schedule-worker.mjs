#!/usr/bin/env node
/**
 * Local persistent schedule worker.
 *
 *   node --experimental-strip-types scripts/schedule-tick.mjs
 *   node --experimental-strip-types scripts/schedule-worker.mjs
 *
 * MIND_WORKER_INTERVAL_MS  milliseconds between passes. Default 60000. Minimum 5000.
 *
 * This process uses the file database on this machine. It is not a hosted worker.
 * Stop it with SIGINT or SIGTERM. It finishes the current pass and exits.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pendingMigrations } from "./migration-plan.mjs";
import { createWorkerLoop } from "../src/lib/mind/worker-loop.ts";
import { runWorkerPass } from "../src/lib/mind/worker-pass.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, ".data", "pglite");
const statusPath = join(root, ".data", "worker-status.json");
const intervalMs = Math.max(5000, Number(process.env.MIND_WORKER_INTERVAL_MS) || 60_000);

function log(event, detail) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, detail, localOnly: true, hosted: false }));
}

function writeStatus(extra) {
  mkdirSync(join(root, ".data"), { recursive: true });
  writeFileSync(statusPath, JSON.stringify({ at: new Date().toISOString(), heartbeatAt: new Date().toISOString(), hosted: false, localOnly: true, mode: "persistent", pid: process.pid, ...extra }));
}

function toSql(pg) {
  const sql = async (strings, ...values) => {
    let text = strings[0];
    for (let index = 0; index < values.length; index += 1) text += `$${index + 1}${strings[index + 1]}`;
    const result = await pg.query(text, values);
    return result.rows;
  };
  sql.query = async (text, params = []) => (await pg.query(text, params)).rows;
  // The local worker must not partially rewrite an owner's workspace.
  if (typeof pg.transaction === "function") {
    sql.transaction = async (fn) => pg.transaction(async (tx) => fn(toSql(tx)));
  }
  return sql;
}

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
const sql = toSql(pg);
const loop = createWorkerLoop({
  log,
  runPass: async () => {
    const result = await runWorkerPass(sql, new Date().toISOString(), `worker-${process.pid}`);
    writeStatus({ running: true, ...result });
    log("pass-result", `Owners ${result.owners}. Schedule triggers ${result.ran}. Agent passes ${result.agentPasses}. Skipped ${result.skipped}. Failed ${result.failed}. Recovered ${result.recovered}.`);
    return result;
  },
});
const stop = () => loop.stop();
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
log("start", `Polling every ${intervalMs} ms. Local file database. Not hosted.`);
writeStatus({ running: true, owners: 0, ran: 0, skipped: 0, failed: 0, recovered: 0 });
while (!loop.stopped) {
  await loop.iteration();
  if (loop.stopped) break;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    process.once("SIGTERM", wake);
    process.once("SIGINT", wake);
  });
}
writeStatus({ running: false });
log("shutdown", "The worker exited. It is not running.");
await pg.close();
