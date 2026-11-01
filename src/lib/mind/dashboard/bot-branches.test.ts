import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allKnownBotBranches,
  branchNamesEqual,
  branchesForBot,
  sanitizeGitBranchName,
} from "./bot-branches.ts";

describe("bot-branches", () => {
  it("sanitizes hostile branch names", () => {
    assert.equal(sanitizeGitBranchName("dashboard-3d"), "dashboard-3d");
    assert.equal(sanitizeGitBranchName("origin/dashboard-3d"), "dashboard-3d");
    assert.equal(sanitizeGitBranchName("feat/foo\nbar"), null);
    assert.equal(sanitizeGitBranchName("evil\u0000branch"), null);
    assert.equal(sanitizeGitBranchName("../etc/passwd"), null);
    assert.equal(sanitizeGitBranchName("-C"), null);
    assert.equal(sanitizeGitBranchName("has space"), null);
  });

  it("maps bots to known + lock branches without inventing", () => {
    assert.deepEqual(branchesForBot("dashboard", null), ["dashboard-3d"]);
    assert.ok(branchesForBot("cosmos-motion", "dashboard-3d-visual-motion").includes("dashboard-3d-visual-motion"));
    assert.equal(branchNamesEqual("dashboard-3d", "dashboard-3d-visual-motion"), false);
    assert.ok(allKnownBotBranches().includes("dashboard-3d"));
  });
});
