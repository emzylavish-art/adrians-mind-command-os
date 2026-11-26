import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Recursively discover executable tests; never follow filesystem symlinks. */
export function discoverTests(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = join(root, entry.name);
    if (entry.isDirectory()) return discoverTests(file);
    return entry.isFile() && /\.test\.(?:mjs|cjs|js|ts)$/.test(entry.name) ? [file] : [];
  }).sort();
}

/** CI runs scripts separately; source shards and npm test share this exact inventory. */
export function testInventory(root = REPOSITORY_ROOT) {
  const paths = (directory) => discoverTests(join(root, directory)).map((file) => relative(root, file))
    // Historical command alias imports mcp/registry.test.ts, which discovery already executes.
    .filter((file) => file !== "src/lib/mind/mcp-registry.test.ts");
  return { scripts: paths("scripts"), source: paths("src") };
}

const USAGE = "Usage: node scripts/run-tests-shard.mjs <zero-based-shard> <shard-count>";
export function parseShardArguments(args) {
  if (args.length !== 2 || !args.every((arg) => /^\d+$/.test(arg))) throw new Error(USAGE);
  const [shard, count] = args.map(Number);
  if (!Number.isSafeInteger(count) || count < 1 || count > 32 || !Number.isSafeInteger(shard) || shard < 0 || shard >= count) throw new Error(USAGE);
  return { shard, count };
}

export function selectTestShard(files, shard, count) {
  parseShardArguments([String(shard), String(count)]);
  const selected = files.filter((_, index) => index % count === shard);
  if (!selected.length) throw new Error(`No tests assigned to shard ${shard}; refusing an empty passing run.`);
  return selected;
}

/** No shell evaluation; run every selected test under the deterministic test environment. */
export function runNodeTests(files, { root = REPOSITORY_ROOT, spawnImpl = spawnSync, tempParent = tmpdir() } = {}) {
  if (!files.length) throw new Error("No tests found; refusing an empty passing run.");
  // Process IDs can repeat between CI jobs or executor sessions. A new parent
  // per invocation prevents those workers from reopening another run's test DB.
  const ownedTemp = mkdtempSync(join(tempParent, "adrian-test-run-"));
  try {
    const { ADRIAN_CASE_REPORT: report, ...childEnvironment } = process.env;
    const reporters = report ? ["--test-reporter=spec", "--test-reporter-destination=stdout",
      "--test-reporter=./scripts/case-reporter.mjs", "--test-reporter-destination=" + report] : [];
    const result = spawnImpl(process.execPath, ["--experimental-strip-types", "--test", ...reporters, "--test-concurrency=1", "--test-timeout=120000", ...files], {
      cwd: root, stdio: "inherit", shell: false, env: { ...childEnvironment, NODE_ENV: "test", TMPDIR: ownedTemp },
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    // Remove only the directory this invocation created, never the caller's TMPDIR.
    rmSync(ownedTemp, { recursive: true, force: true });
  }
}
