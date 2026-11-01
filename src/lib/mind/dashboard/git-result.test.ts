import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectRecentCommits, collectRecentCommitsResult } from "./git.ts";

describe("git result (hacker pass: no silent green)", () => {
  it("reports ok=false for a non-repo instead of an empty-but-ok list", () => {
    const dir = mkdtempSync(join(tmpdir(), "notgit-"));
    // the old API silently returns []
    assert.deepEqual(collectRecentCommits(dir, 5), []);
    const res = collectRecentCommitsResult(dir, 5);
    assert.equal(res.ok, false);
    assert.ok(!res.ok && res.error.includes("git unavailable"));
  });

  it("reports ok=false for a missing directory", () => {
    const res = collectRecentCommitsResult("/workspace/definitely-missing-repo-xyz", 5);
    assert.equal(res.ok, false);
  });

  it("works on a real repo and clamps silly limits", () => {
    const res = collectRecentCommitsResult(process.cwd(), Number.NaN);
    assert.equal(res.ok, true);
    assert.ok(res.commits.length <= 20);
  });
});
