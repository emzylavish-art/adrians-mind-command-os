import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectTestShard, testInventory } from "./test-inventory.mjs";

const directory = process.argv[2];
if (!directory) throw Error("Supply the directory with all five case reports.");
const inventory = testInventory();
const groups = [["scripts", inventory.scripts]];
for (let shard = 0; shard < 4; shard++)
  groups.push(["shard-" + shard, selectTestShard(inventory.source, shard, 4)]);
const identities = new Set();
const totals = {};
for (const [group, expected] of groups) {
  const lines = readFileSync(join(directory, "cases-" + group + ".jsonl"), "utf8")
    .trim()
    .split("\n");
  const observed = new Set();
  for (const line of lines) {
    const record = JSON.parse(line);
    const identity = JSON.stringify([record.file, record.line, record.name]);
    assert(!identities.has(identity), "Repeated case in " + group + ": " + identity);
    identities.add(identity);
    observed.add(record.file);
    totals[record.result] = (totals[record.result] ?? 0) + 1;
  }
  assert.deepEqual(
    [...observed].sort(),
    [...expected].sort(),
    group + " did not report its assigned files",
  );
}
console.log(
  JSON.stringify({
    cases: identities.size,
    totals,
    scripts: inventory.scripts.length,
    source: inventory.source.length,
  }),
);
assert.equal(totals.fail ?? 0, 0, "A discovered case failed");
