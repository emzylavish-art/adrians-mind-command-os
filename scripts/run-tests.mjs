import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runNodeTests, testInventory } from "./test-inventory.mjs";
export { discoverTests } from "./test-inventory.mjs";

export function main() {
  const files = testInventory();
  return runNodeTests([...files.scripts, ...files.source]);
}

// Importing the discovery runner from a regression must never recursively launch npm test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
