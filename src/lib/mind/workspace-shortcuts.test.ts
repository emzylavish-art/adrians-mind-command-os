import assert from "node:assert/strict";
import { test } from "node:test";
import { readWorkspaceShortcuts } from "./workspace-shortcuts.ts";
import { readInterface } from "./interface-preferences.ts";

test("shortcut recovery preserves explicit empty and saved order while dropping unusable items", () => {
  const allowed = ["command", "build", "social"];
  const defaults = ["command", "build"];
  assert.deepEqual(readWorkspaceShortcuts(null, allowed, defaults), defaults);
  assert.deepEqual(readWorkspaceShortcuts("not valid JSON", allowed, defaults), defaults);
  assert.deepEqual(readWorkspaceShortcuts("[]", allowed, defaults), []);
  assert.deepEqual(readWorkspaceShortcuts('["social", "missing", "build", "social"]', allowed, defaults), ["social", "build"]);
});

test("persisted keyboard settings reject reserved, duplicate and invalid bindings", () => {
  const raw = JSON.stringify({ sendKey: "modified", bindings: { newChat: "", branch: "Alt+P", send: "Mod+Enter", queue: "KeyQ", build: "Mod+Shift+B", settings: "Mod+Shift+B" } });
  assert.deepEqual(readInterface({ getItem: () => raw }).bindings, { newChat: "", build: "Mod+Shift+B" });
});
