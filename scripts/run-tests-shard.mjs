#!/usr/bin/env node
/**
 * Execute one disjoint shard of the existing typed test command.
 * The source of truth remains package.json:scripts.test.
 * No shell interpolation or untrusted command evaluation.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const shard = Number(process.argv[2]);
const count = Number(process.argv[3]);
if (!Number.isInteger(count) || count < 1 || count > 32 ||
    !Number.isInteger(shard) || shard < 0 || shard >= count) {
  console.error("Usage: node scripts/run-tests-shard.mjs <zero-based-shard> <shard-count>");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const command = manifest.scripts?.test ?? "";
const sections = command.split(" && ");
const prefix = "node --experimental-strip-types --test ";
if (sections.length !== 2 || !sections[1].startsWith(prefix)) {
  console.error("Test script has changed; refusing to silently omit test files.");
  process.exit(2);
}
const allFiles = sections[1].slice(prefix.length).trim().split(/\s+/).map((s) => s.replace(/^['"]|['"]$/g, ""));
if (!allFiles.length || !allFiles.every((name) =>
  /^src\/[a-zA-Z0-9_./-]+\.test\.ts$/.test(name) &&
  !name.includes("..") && existsSync(resolve(name)))) {
  console.error("Test inventory contains an unsafe or missing file.");
  process.exit(2);
}
const selected = allFiles.filter((_, i) => i % count === shard);
if (!selected.length) {
  console.error("No tests assigned to shard " + shard);
  process.exit(2);
}
console.log(JSON.stringify({ shard, count, total: allFiles.length, selected: selected.length }));
const runner = spawn(process.execPath,
  ["--experimental-strip-types", "--test", "--test-concurrency=4", ...selected],
  { stdio: "inherit", shell: false });
runner.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
runner.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
