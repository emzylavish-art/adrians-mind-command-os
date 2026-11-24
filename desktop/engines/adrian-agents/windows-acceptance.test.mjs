import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkBoot, checkCoexistence, readBootProbe, runChecks } from "./windows-acceptance.mjs";

test("portable helper evidence leaves each installed acceptance check blocked", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "adrian-agents-accept-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checks = runChecks({
    platform: "linux",
    root,
    taskRegistered: false,
    processRunning: false,
    paperclipRunning: false,
    runnerRunning: false,
    tradingLoopRunning: false,
    workerThreads: 2,
    memoryCeilingMb: 1024,
  });
  const byName = Object.fromEntries(checks.map((check) => [check.name, check.status]));
  assert.deepEqual(byName, {
    boot: "BLOCKED",
    approval: "BLOCKED",
    "brain-swap": "BLOCKED",
    coexistence: "BLOCKED",
    "delete-refusal": "BLOCKED",
  });
});

test("boot fails for missing components and requires job evidence beyond process presence", () => {
  const runtime = String.raw`C:\Adrian Mind\desktop\engines\adrian-agents\runtime.mjs`;
  const command = `"C:\\Program Files\\nodejs\\node.exe" "${runtime}"`;
  const probe = readBootProbe(true, command, runtime);
  assert.equal(checkBoot({ platform: "win32", ...probe }).status, "BLOCKED");
  assert.equal(checkBoot({ platform: "linux", ...probe }).status, "BLOCKED");
  assert.equal(checkBoot({ platform: "win32", ...readBootProbe(null, command, runtime) }).status, "BLOCKED");
  assert.equal(checkBoot({ platform: "win32", ...readBootProbe(true, null, runtime) }).status, "BLOCKED");
  for (const sample of ["node.exe", 'node.exe "C:\\other\\runtime.mjs"', command + ".old", ""]) {
    assert.equal(checkBoot({ platform: "win32", ...readBootProbe(true, sample, runtime) }).status, "FAIL");
  }
  assert.equal(checkBoot({ platform: "win32", ...readBootProbe(false, command, runtime) }).status, "FAIL");
});


test("configuration limits and reported process presence do not prove measured coexistence", () => {
  const env = { platform: "win32", paperclipRunning: true, runnerRunning: true, tradingLoopRunning: true, workerThreads: 2, memoryCeilingMb: 1024 };
  assert.equal(checkCoexistence(env).status, "BLOCKED");
  assert.equal(checkCoexistence({ ...env, workerThreads: 3 }).status, "FAIL");
});
