import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { discoverTests, parseShardArguments, runNodeTests, selectTestShard, testInventory } from "./test-inventory.mjs";
import * as fullRunner from "./run-tests.mjs";
import * as shardRunner from "./run-tests-shard.mjs";

test("AA082: importing test runners is side-effect free and four shards cover every source test exactly once", () => {
  assert.equal(typeof fullRunner.main, "function");
  assert.equal(typeof shardRunner.main, "function");
  const inventory = testInventory();
  assert.ok(inventory.source.length > 0);
  const shards = Array.from({ length: 4 }, (_, shard) => selectTestShard(inventory.source, shard, 4));
  const combined = shards.flat();
  assert.equal(new Set(combined).size, combined.length);
  assert.deepEqual(combined.sort(), inventory.source);
  assert.equal(combined.some((file) => file.startsWith("scripts/")), false);
  assert.ok(inventory.scripts.includes("scripts/test-inventory.test.mjs"));
  assert.ok(inventory.source.includes("src/lib/supabase/callback-redirect.test.ts"));
  assert.ok(inventory.source.includes("src/components/mind/dashboard-3d/c2-dashboard-recovery.test.ts"));
});

test("AA082: newly nested tests enter discovery without following external symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "mind-test-inventory-"));
  try {
    mkdirSync(join(root, "nested", "deeper"), { recursive: true });
    writeFileSync(join(root, "nested", "deeper", "fresh.test.ts"), "");
    writeFileSync(join(root, "runner.test.mjs"), "");
    writeFileSync(join(root, "fixture.ts"), "");
    symlinkSync(join(root, "nested"), join(root, "linked"), "dir");
    assert.deepEqual(discoverTests(root), [join(root, "nested", "deeper", "fresh.test.ts"), join(root, "runner.test.mjs")]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AA082: invalid or empty shards fail before any test command can launch", () => {
  for (const args of [[], ["0"], ["0", "4", "extra"], ["-1", "4"], ["4", "4"], ["0", "0"], ["0", "33"], ["1.5", "4"], ["1e0", "4"], ["", "4"]]) assert.throws(() => parseShardArguments(args), /Usage:/);
  assert.throws(() => selectTestShard([], 0, 1), /No tests assigned/);
  assert.throws(() => runNodeTests([]), /No tests found/);
  const invalid = spawnSync(process.execPath, [new URL("./run-tests-shard.mjs", import.meta.url).pathname, "invalid", "4"], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Usage:/);
  assert.equal(invalid.stdout, "");
});

test("AA082: full and shard execution share Node test options and NODE_ENV=test", () => {
  const calls = [];
  const result = runNodeTests(["src/a.test.ts", "src/nested/b.test.ts"], { root: "/fixture", spawnImpl(command, args, options) { calls.push({ command, args, options }); return { status: 0 }; } });
  assert.equal(result, 0);
  assert.deepEqual(calls[0].args, ["--experimental-strip-types", "--test", "--test-concurrency=1", "--test-timeout=120000", "src/a.test.ts", "src/nested/b.test.ts"]);
  assert.equal(calls[0].options.env.NODE_ENV, "test");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, "/fixture");
});

test("AA082: repeated runner invocations receive fresh temporary storage and clean only their own directory", () => {
  const parent = mkdtempSync(join(tmpdir(), "mind-runner-parent-"));
  const directories = [];
  const sentinel = join(parent, "caller-owned.txt");
  writeFileSync(sentinel, "keep");
  try {
    for (const status of [0, 7]) {
      const result = runNodeTests(["src/fixture.test.ts"], { tempParent: parent, spawnImpl(_command, _args, options) {
        const directory = options.env.TMPDIR;
        assert.ok(directory.startsWith(join(parent, "adrian-test-run-")));
        assert.ok(existsSync(directory));
        directories.push(directory);
        writeFileSync(join(directory, "persistent-test-row.json"), "{}");
        return { status };
      } });
      assert.equal(result, status);
      assert.equal(existsSync(directories.at(-1)), false);
      assert.equal(readFileSync(sentinel, "utf8"), "keep");
    }
    assert.notEqual(directories[0], directories[1]);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("AA082: runner cleanup also happens when child startup throws or returns an error", () => {
  const parent = mkdtempSync(join(tmpdir(), "mind-runner-error-"));
  try {
    for (const throwDirectly of [false, true]) {
      let directory;
      assert.throws(() => runNodeTests(["src/fixture.test.ts"], { tempParent: parent, spawnImpl(_command, _args, options) {
        directory = options.env.TMPDIR;
        const error = new Error("Synthetic spawn failure");
        if (throwDirectly) throw error;
        return { error, status: null };
      } }), /Synthetic spawn failure/);
      assert.equal(existsSync(directory), false);
      assert.equal(existsSync(parent), true);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
