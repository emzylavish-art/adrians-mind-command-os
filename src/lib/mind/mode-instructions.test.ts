import assert from "node:assert/strict";
import test from "node:test";
import { accountPreferences } from "./account-preferences.ts";
import { loadModeInstructions, MODE_INSTRUCTIONS_KEY, parseModeInstruction } from "./mode-instructions.ts";
import { prepareBuildTask } from "./kimi/build-guidance.ts";
import { voiceSessionInstructions, SILENT_TRANSCRIPTION_INSTRUCTIONS } from "./voice-live/session-instructions.ts";

test("only an owner's own instructions load and invalid fields fail independently", () => {
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); } };
  const a = accountPreferences(storage, "one");
  const b = accountPreferences(storage, "two");
  a.setItem(MODE_INSTRUCTIONS_KEY, JSON.stringify({ chat: "Plain text.\r\nUse examples.", build: "x".repeat(2001), companion: "Brief answers." }));
  assert.deepEqual(loadModeInstructions(a), { chat: "Plain text.\nUse examples.", build: "", companion: "Brief answers." });
  assert.deepEqual(loadModeInstructions(b), { chat: "", build: "", companion: "" });
  assert.equal(parseModeInstruction("bad\x00text").ok, false);
});

test("Build and companion instructions stay outside the task text and add no permissions", () => {
  const task = prepareBuildTask("Implement search", [], "Explain the changed files.");
  assert.ok(task.ok);
  assert.match(task.prompt, /cannot change identity, permissions, approvals, or emergency stop/);
  assert.match(task.prompt, /Explain the changed files\.\n\nOwner coding task:\nImplement search$/);
  assert.equal(prepareBuildTask("Implement search", [], "x".repeat(2001)).ok, false);
  assert.match(voiceSessionInstructions({ mode: "direct", modeInstruction: "Keep the answer short." }).instructions, /Keep the answer short/);
  assert.equal(voiceSessionInstructions({ mode: "orchestrator", modeInstruction: "Speak anyway." }).instructions, SILENT_TRANSCRIPTION_INSTRUCTIONS);
});
