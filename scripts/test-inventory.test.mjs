import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverTests, selectShard } from "./test-inventory.mjs";

test("new nested regressions enter npm and exactly one CI shard without manifest edits", () => {
  const root = mkdtempSync(join(tmpdir(), "mind-test-inventory-"));
  try {
    for (const folder of ["src/nested", "scripts/checks"]) mkdirSync(join(root, folder), { recursive: true });
    for (const file of ["src/a.test.ts", "src/nested/new.test.ts", "scripts/checks/runner.test.mjs", "scripts/checks/verify-live.mjs"]) writeFileSync(join(root, file), "");
    symlinkSync(root, join(root, "src/loop"), "dir");
    const all = discoverTests(root);
    assert.deepEqual(all, ["scripts/checks/runner.test.mjs", "src/a.test.ts", "src/nested/new.test.ts"]);
    const typed = discoverTests(root, "typed");
    const shards = Array.from({ length: 4 }, (_, i) => selectShard(typed, i, 4)).flat();
    assert.deepEqual([...shards].sort(), typed);
    assert.equal(new Set(shards).size, shards.length);
    assert.throws(() => selectShard(typed, 4, 4));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the formerly omitted Notion, privacy, provider and voice suites are registered", () => {
  const files = discoverTests();
  for (const name of ["src/lib/mind/connectors/workspace-grants.test.ts", "src/lib/mind/conversation-actions.test.ts", "src/lib/mind/voice/voice-chat-turn.test.ts", "src/lib/mind/connected-mcp-health.test.ts", "src/lib/mind/settings-reset.test.ts"]) assert.ok(files.includes(name), name);
});
