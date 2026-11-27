import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeTests, testInventory } from "./test-inventory.mjs";
export { discoverTests } from "./test-inventory.mjs";

export function main(args = []) {
  if (args.length && !(args.length === 1 && args[0] === "--scripts")) throw new Error("Usage: node scripts/run-tests.mjs [--scripts]");
  const files = testInventory();
  return runNodeTests(args.length ? files.scripts : [...files.scripts, ...files.source]);
}

// Importing the discovery runner from a regression must never recursively launch npm test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
