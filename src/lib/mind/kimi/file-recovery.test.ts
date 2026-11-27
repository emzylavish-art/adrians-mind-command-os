import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { restoreMissingWorkspaceFile } from "./file-recovery.ts";

test("browsing restores missing files without overwriting a write whose durability failed", t => {
  const root = mkdtempSync(join(tmpdir(), "build-recovery-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "current.txt"), "new local work");
  assert.equal(restoreMissingWorkspaceFile(root, "current.txt", "stale saved copy"), false);
  assert.equal(readFileSync(join(root, "current.txt"), "utf8"), "new local work");
  assert.equal(restoreMissingWorkspaceFile(root, "missing.txt", "saved copy"), true);
  assert.equal(readFileSync(join(root, "missing.txt"), "utf8"), "saved copy");
  assert.equal(restoreMissingWorkspaceFile(root, "../outside.txt", "no"), false);
});
