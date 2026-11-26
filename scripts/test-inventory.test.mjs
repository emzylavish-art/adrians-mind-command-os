import test from "node:test";
import assert from "node:assert/strict";
import { discoverTests } from "./test-inventory.mjs";
test("normal runner discovers connector regressions and unique typed/script files", () => {
  const files = discoverTests();
  assert.ok(files.includes("src/lib/mind/connectors/workspace-grants.test.ts"));
  assert.ok(files.includes("src/lib/mind/connectors/google-account.test.ts"));
  assert.ok(files.includes("scripts/test-inventory.test.mjs"));
  assert.equal(new Set(files).size, files.length);
});
