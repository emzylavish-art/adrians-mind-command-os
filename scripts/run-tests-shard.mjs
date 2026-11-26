#!/usr/bin/env node
/**
 * Execute one disjoint shard of the existing typed test command.
 * The source of truth remains package.json:scripts.test.
 * No shell interpolation or untrusted command evaluation.
 */
import { discoverTests } from "./test-inventory.mjs";
import { runDiscoveredTests } from "./test-runner.mjs";

const shard = Number(process.argv[2]);
const count = Number(process.argv[3]);
if (!Number.isInteger(count) || count < 1 || count > 32 ||
    !Number.isInteger(shard) || shard < 0 || shard >= count) {
  console.error("Usage: node scripts/run-tests-shard.mjs <zero-based-shard> <shard-count>");
  process.exit(2);
}
const allFiles = discoverTests();
const selected = allFiles.filter((_, i) => i % count === shard);
if (!selected.length) {
  console.error("No tests assigned to shard " + shard);
  process.exit(2);
}
console.log(JSON.stringify({ shard, count, total: allFiles.length, selected: selected.length }));
process.exitCode = await runDiscoveredTests(selected);
