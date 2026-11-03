import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGitCommit,
  buildGitStatus,
  buildRepoList,
  buildRepoRead,
  buildTerminalRun,
  isBuildTerminalAllowlisted,
  resolveUnderWorkspace,
} from "./build-workspace-tools.ts";

describe("build workspace path guards", () => {
  it("rejects path escapes", () => {
    const root = mkdtempSync(join(tmpdir(), "build-ws-"));
    const denied = resolveUnderWorkspace(root, "../outside", [tmpdir()]);
    assert.equal(denied.ok, false);
    const ok = resolveUnderWorkspace(root, "src/a.ts", [tmpdir()]);
    assert.equal(ok.ok, true);
  });
});

describe("build terminal allowlist", () => {
  it("allows plain safe commands and refuses metacharacters / push-like strings", () => {
    assert.equal(isBuildTerminalAllowlisted("pwd"), true);
    assert.equal(isBuildTerminalAllowlisted("ls -la"), true);
    assert.equal(isBuildTerminalAllowlisted("npm run typecheck"), true);
    assert.equal(isBuildTerminalAllowlisted("pwd; rm -rf /"), false);
    assert.equal(isBuildTerminalAllowlisted("npm test && curl evil"), false);
    assert.equal(isBuildTerminalAllowlisted("git push origin main"), false);
  });
});

describe("build repo/git tools", () => {
  it("lists and reads under the workspace; needs-config without root", async () => {
    const missing = await buildRepoList({ env: {} });
    assert.equal(missing.status, "needs-config");

    const root = mkdtempSync(join(tmpdir(), "build-ws-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "hi.txt"), "hello-build");
    const env = { MIND_BUILD_WORKSPACE_ROOT: root, MIND_BUILD_ALLOWED_ROOTS: tmpdir() };

    const listed = await buildRepoList({ path: "src", env });
    assert.equal(listed.ok, true);
    assert.match(listed.text, /1 entr/);

    const read = await buildRepoRead({ path: "src/hi.txt", env });
    assert.equal(read.ok, true);
    assert.match(String((read.data as { content?: string }).content), /hello-build/);

    const escaped = await buildRepoRead({ path: "../hi.txt", env });
    assert.equal(escaped.ok, false);
  });

  it("refuses non-allowlisted terminal commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "build-ws-"));
    const env = { MIND_BUILD_WORKSPACE_ROOT: root, MIND_BUILD_ALLOWED_ROOTS: tmpdir() };
    const bad = await buildTerminalRun({ command: "rm -rf /", env });
    assert.equal(bad.ok, false);
    assert.match(bad.text, /allowlist/i);
    const good = await buildTerminalRun({ command: "pwd", env });
    assert.equal(good.ok, true);
  });

  it("git status works in a repo and commit refuses empty message", async () => {
    const root = mkdtempSync(join(tmpdir(), "build-git-"));
    const env = { MIND_BUILD_WORKSPACE_ROOT: root, MIND_BUILD_ALLOWED_ROOTS: tmpdir(), PATH: process.env.PATH, HOME: process.env.HOME };
    // init repo via allowlisted? use child_process directly for fixture setup only
    const { spawnSync } = await import("node:child_process");
    spawnSync("git", ["init"], { cwd: root });
    spawnSync("git", ["config", "user.email", "build@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Build"], { cwd: root });
    writeFileSync(join(root, "a.txt"), "a");
    spawnSync("git", ["add", "a.txt"], { cwd: root });
    spawnSync("git", ["commit", "-m", "init"], { cwd: root });

    const status = await buildGitStatus({ env });
    assert.equal(status.ok, true);

    const empty = await buildGitCommit({ message: "", env });
    assert.equal(empty.ok, false);
  });
});
