import assert from "node:assert/strict";
import test from "node:test";
import { addOpenClawBot, configureOpenClawLimits, loadOpenClawSkills, noteOpenClawService, openClawStatus, openClawTurn, resetOpenClawRuntime } from "./openclaw-runtime.ts";

test("OpenClaw stays a separate worker and does not claim it is running", () => {
  resetOpenClawRuntime();
  const status = openClawStatus();
  assert.equal(status.role, "parallel-worker");
  assert.equal(status.board, "paperclip");
  assert.equal(status.touchesMindOs, false);
  assert.equal(status.service, "not-running");
  assert.equal(status.startsAfter, "mind-os-engines");
  assert.equal(status.cpuPriority, "below-mind-os");
  assert.equal(status.workerThreads, 2);
  assert.equal(status.memoryCeilingMb, 1024);
  assert.equal(status.pollIntervalMs, 15000);
  assert.equal(openClawTurn("files", "hello").refused, "OpenClaw is not running on this PC.");
});

test("OpenClaw refuses a Mind OS port and a higher resource cap", () => {
  resetOpenClawRuntime();
  assert.equal(configureOpenClawLimits({ port: 9400, workerThreads: 2, memoryCeilingMb: 1024, pollIntervalMs: 15000 }).refused, "OpenClaw cannot use a Mind OS port.");
  assert.equal(configureOpenClawLimits({ port: 8787, workerThreads: 4, memoryCeilingMb: 1024, pollIntervalMs: 15000 }).refused, "OpenClaw worker threads stay at 1 or 2.");
  noteOpenClawService(true, 9400);
  assert.equal(openClawStatus().service, "not-running");
});

test("a bot stores that a token exists, not the token", () => {
  resetOpenClawRuntime();
  const refused = addOpenClawBot({ id: "desk", channel: "telegram", brain: "grok", token: "short" });
  assert.equal("refused" in refused, true);
  const added = addOpenClawBot({ id: "desk", channel: "telegram", brain: "grok", token: "telegram-token-value" });
  assert.equal("tokenPresent" in added && added.tokenPresent, true);
  assert.equal(JSON.stringify(openClawStatus()).includes("telegram-token-value"), false);
});

test("skills are SKILL.md files and a turn is accepted only after the service is noted running", () => {
  resetOpenClawRuntime();
  assert.deepEqual(loadOpenClawSkills(["notes.txt", "skills/files/SKILL.md"]), ["skills/files/SKILL.md"]);
  addOpenClawBot({ id: "desk", channel: "telegram", brain: "ollama-qwen", token: "telegram-token-value" });
  noteOpenClawService(true, 8787);
  const turn = openClawTurn("desk", "list the downloads");
  assert.equal("accepted" in turn && turn.accepted, true);
  assert.equal(openClawStatus().port, 8787);
});
