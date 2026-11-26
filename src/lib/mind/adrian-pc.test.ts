import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAdrianPc } from "./adrian-pc.server.ts";
const visionPolicy = { model: "selected-fixture", allowExternalImage: true, allowFallback: false, captureScope: "primary-screen" as const, timeoutMs: 50 };

test("halt and policy refusal are recognized without dispatch or false ran success", async () => {
  let calls = 0;
  const stopped = await runAdrianPc({ text: "move the mouse and go to my files", halted: true, platform: "win32", executeAction: async () => { calls++; return { state: "completed", output: "fixture" }; } });
  assert.equal(stopped.recognized, true); assert.equal(stopped.ran, false); assert.equal(stopped.completed, false); assert.equal(stopped.authorized, false); assert.equal(calls, 0);
  const refused = await runAdrianPc({ text: "buy a laptop and go to my files", halted: false });
  assert.equal(refused.ran, false); assert.match(refused.output, /Nothing was purchased/);
  const wipe = await runAdrianPc({ text: "wipe the disk and go to my files", halted: false });
  assert.equal(wipe.ran, false); assert.match(wipe.output, /Nothing was deleted/);
});
test("normal text does not become a computer request", async () => {
  const result = await runAdrianPc({ text: "What is a file?", halted: false });
  assert.equal(result.recognized, false); assert.equal(result.ran, false); assert.equal(result.state, "unrecognized");
});
test("local files work in an isolated folder and payload words never dispatch extra actions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adrian-pc-"));
  try {
    const wrote = await runAdrianPc({ text: 'write file notes.txt: hello and click 10 20 then launch app calculator', halted: false, root, platform: "linux" });
    assert.equal(wrote.receipts.length, 1); assert.equal(wrote.completed, true); assert.equal(wrote.verified, false);
    const read = await runAdrianPc({ text: "read file notes.txt", halted: false, root, platform: "linux" });
    assert.match(read.output, /hello and click 10 20/); assert.equal(read.completed, true);
    const listed = await runAdrianPc({ text: "go to my files", halted: false, root, platform: "linux" }); assert.match(listed.output, /notes.txt/);
    const command = await runAdrianPc({ text: "run command printf ok", halted: false, root, platform: "linux" }); assert.match(command.output, /ok/); assert.equal(command.completed, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("owner path rejects parent symlink and traversal before reading or writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "adrian-pc-")); const outside = await mkdtemp(path.join(tmpdir(), "outside-pc-"));
  try {
    await writeFile(path.join(outside, "private.txt"), "private fixture"); await symlink(outside, path.join(root, "linked"));
    const read = await runAdrianPc({ text: "read file linked/private.txt", halted: false, root }); assert.doesNotMatch(read.output, /private fixture/); assert.equal(read.completed, false);
    const write = await runAdrianPc({ text: "write file ../escape.txt: no", halted: false, root }); assert.equal(write.completed, false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test("unsupported Windows primitive is blocked with zero attempts", async () => {
  for (const text of ["click 10 20", "right-click 12 12", "double-click 12 12", "look at my screen", "launch app calculator"]) {
    const result = await runAdrianPc({ text, halted: false, platform: "linux" });
    assert.equal(result.ran, false, text); assert.equal(result.completed, false); assert.match(result.output, /not Windows/);
  }
});
test("finding zero, one or multiple buttons is always read-only", async () => {
  let clicks = 0;
  for (const names of [[], ["Save"], ["Save", "Save"]]) {
    const result = await runAdrianPc({ text: "find button Save", halted: false, platform: "win32", findButtons: async () => names, clickButton: async () => { clicks++; return true; } });
    assert.equal(result.completed, true); assert.match(result.output, /Nothing was clicked/);
  }
  assert.equal(clicks, 0);
});
test("explicit named click targets exact window and rechecks halt before invocation", async () => {
  let clicks = 0; let stopped = false;
  const result = await runAdrianPc({ text: 'click button "Save" in window "Document"', halted: false, platform: "win32", findButtons: async (name, window) => { assert.equal(name, "Save"); assert.equal(window, "Document"); return ["Save"]; }, clickButton: async (name, window) => { assert.equal(window, "Document"); clicks++; return true; } });
  assert.equal(clicks, 1); assert.equal(result.completed, true); assert.equal(result.verified, false);
  const denied = await runAdrianPc({ text: 'click button "Save" in window "Document"', halted: false, recheckHalt: () => stopped, platform: "win32", findButtons: async () => { stopped = true; return ["Save"]; }, clickButton: async () => { clicks++; return true; } });
  assert.equal(denied.ran, false); assert.equal(clicks, 1);
});
test("right and double click each invoke only their typed primitive", async () => {
  for (const [text, expected] of [["right-click 12 12", "right_click"], ["double-click 12 12", "double_click"]]) {
    const calls: string[] = [];
    const result = await runAdrianPc({ text, halted: false, executeAction: async action => { calls.push(action.kind); return { state: "completed", output: action.kind }; } });
    assert.deepEqual(calls, [expected]); assert.equal(result.receipts.length, 1);
  }
});
test("failed or thrown prerequisite blocks dependent action; permission is rechecked each step", async () => {
  let calls = 0;
  const failed = await runAdrianPc({ text: "list windows then click 12 12", halted: false, executeAction: async () => { calls++; return { state: "failed", output: "fixture failure" }; } });
  assert.equal(calls, 1); assert.equal(failed.receipts[1].attempted, false);
  const thrown = await runAdrianPc({ text: "list windows then click 12 12", halted: false, executeAction: async () => { throw new Error("fixture transport gone"); } });
  assert.equal(thrown.state, "unconfirmed"); assert.equal(thrown.receipts[1].attempted, false);
  let stop = false; calls = 0;
  const changed = await runAdrianPc({ text: "list windows then click 12 12", halted: false, recheckHalt: () => stop, executeAction: async () => { calls++; stop = true; return { state: "completed", output: "fixture observation" }; } });
  assert.equal(calls, 1); assert.equal(changed.receipts[1].state, "blocked");
});
test("capture requires explicit external policy and never invents a missing reading", async () => {
  let captures = 0;
  const blocked = await runAdrianPc({ text: "understand the screenshot", halted: false, captureScreen: async () => { captures++; return Buffer.alloc(40); } });
  assert.equal(blocked.ran, false); assert.equal(captures, 0);
  const empty = await runAdrianPc({ text: "understand the screenshot", halted: false, visionPolicy, captureScreen: async () => Buffer.alloc(40), readImage: async () => " " });
  assert.equal(empty.completed, false); assert.match(empty.output, /no reading/);
  const result = await runAdrianPc({ text: "understand the screenshot", halted: false, visionPolicy, captureScreen: async () => Buffer.alloc(40), readImage: async () => "Fixture window" });
  assert.equal(result.completed, true); assert.match(result.output, /injected adapter \(live provider unverified\)/);
});
test("capture timeout cannot late-dispatch a model; late provider result is unconfirmed", async () => {
  let answerCalls = 0; let finishCapture: ((value: Buffer) => void) | undefined;
  const result = await runAdrianPc({ text: "understand the screenshot", halted: false, visionPolicy: { ...visionPolicy, timeoutMs: 8 }, captureScreen: () => new Promise(resolve => { finishCapture = resolve; }), readImage: async () => { answerCalls++; return "late"; } });
  assert.match(result.output, /timed out/); finishCapture?.(Buffer.alloc(40)); await Promise.resolve(); assert.equal(answerCalls, 0);
  const response = await runAdrianPc({ text: "understand the screenshot", halted: false, visionPolicy: { ...visionPolicy, timeoutMs: 8 }, captureScreen: async () => Buffer.alloc(40), readImage: () => new Promise(() => {}) });
  assert.equal(response.state, "unconfirmed"); assert.match(response.output, /unknown/);
});
