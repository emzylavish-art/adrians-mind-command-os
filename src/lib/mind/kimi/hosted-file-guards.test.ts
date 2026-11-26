import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileRevision, plainFile, safeWorkspaceFile } from "./hosted-file-guards.ts";

test("hosted file revisions are stable and change with reviewed content", () => {
  assert.equal(fileRevision("same"), fileRevision("same"));
  assert.notEqual(fileRevision("same"), fileRevision("changed"));
});

test("hosted workspace guards reject a symlinked escape and non-files", () => {
  const root = mkdtempSync(join(tmpdir(), "adrian-hosted-guard-"));
  const outside = mkdtempSync(join(tmpdir(), "adrian-hosted-outside-"));
  const regular = join(root, "regular.txt");
  const linkedDirectory = join(root, "linked");
  try {
    mkdirSync(linkedDirectory, { recursive: true });
    writeFileSync(regular, "reviewed");
    symlinkSync(outside, join(root, "escape"));

    assert.equal(plainFile(regular), true);
    assert.equal(plainFile(root), false);
    assert.equal(safeWorkspaceFile(root, regular), true);
    assert.equal(safeWorkspaceFile(root, resolve(root, "escape", "private.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
