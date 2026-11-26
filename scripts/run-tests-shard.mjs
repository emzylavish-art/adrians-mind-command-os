#!/usr/bin/env node
/**
 * Execute one disjoint shard of all discovered source tests.
 * Script tests stay in the existing separate CI job.
 * No shell interpolation or untrusted command evaluation.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseShardArguments, runNodeTests, selectTestShard, testInventory } from "./test-inventory.mjs";

export function main(args = process.argv.slice(2)) {
  let selection;
  try {
    const { shard, count } = parseShardArguments(args);
    const allFiles = testInventory().source;
    const selected = selectTestShard(allFiles, shard, count);
    console.log(JSON.stringify({ shard, count, total: allFiles.length, selected: selected.length }));
    selection = selected;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  return runNodeTests(selection);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
