import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkBoot, readBootProbe, runChecks } from "./windows-acceptance.mjs";

test("the script passes only the checks it can see and fails the Windows-only ones", () => {
  const checks = runChecks({
    platform: "linux",
    root: mkdtempSync(path.join(tmpdir(), "openclaw-accept-")),
    taskRegistered: false,
    processRunning: false,
    paperclipRunning: false,
    runnerRunning: false,
    tradingLoopRunning: false,
    workerThreads: 2,
    memoryCeilingMb: 1024,
  });
  const byName = Object.fromEntries(checks.map((check) => [check.name, check.status]));
  assert.equal(byName.boot, "FAIL");
  assert.equal(byName.approval, "PASS");
  assert.equal(byName["brain-swap"], "PASS");
  assert.equal(byName.coexistence, "BLOCKED");
  assert.equal(byName["delete-refusal"], "PASS");
  assert.equal(checks.some((check) => check.status === "FAIL"), true);
});

test("boot passes only when the login task and process are both present", () => {
  const probe = readBootProbe("TaskName: AdriansMind-OpenClaw\nnode.exe openclaw");
  assert.equal(probe.taskRegistered, true);
  assert.equal(probe.processRunning, true);
  assert.equal(checkBoot({ platform: "win32", ...probe }).status, "PASS");
  assert.equal(checkBoot({ platform: "linux", ...probe }).status, "FAIL");
});
