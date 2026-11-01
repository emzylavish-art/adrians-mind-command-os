import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { locksDirFromEnvSafe, repoDirFromEnvSafe, resolveAllowedDir } from "./safe-paths.ts";

describe("safe-paths", () => {
  it("rejects path traversal outside allowlist", () => {
    const r = resolveAllowedDir("/etc", "/workspace/locks", ["/workspace/locks"]);
    assert.equal(r.path, "/workspace/locks");
    assert.match(r.rejected ?? "", /Rejected/);
  });

  it("accepts nested paths under locks root", () => {
    const r = resolveAllowedDir("/workspace/locks/nested", "/workspace/locks", ["/workspace/locks"]);
    assert.equal(r.path, "/workspace/locks/nested");
    assert.equal(r.rejected, undefined);
  });

  it("falls back when MIND_REPO_DIR points at /", () => {
    const r = repoDirFromEnvSafe({ MIND_REPO_DIR: "/" });
    assert.equal(r.path, "/workspace/mind-command-os");
    assert.ok(r.rejected);
  });

  it("accepts default locks dir", () => {
    assert.equal(locksDirFromEnvSafe({}).path, "/workspace/locks");
  });
});
