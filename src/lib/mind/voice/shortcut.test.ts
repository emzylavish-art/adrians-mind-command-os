import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEditableKeyboardTarget,
  matchesVoiceToggleShortcut,
  voiceMicAriaLabel,
  voiceMicShortcutHint,
  VOICE_TOGGLE_SHORTCUT,
} from "./shortcut.ts";

describe("voice toggle shortcut", () => {
  it("matches Ctrl/Cmd+Shift+V and rejects bare V or Ctrl+K", () => {
    assert.equal(
      matchesVoiceToggleShortcut({ key: "v", shiftKey: true, ctrlKey: true, metaKey: false }),
      true,
    );
    assert.equal(
      matchesVoiceToggleShortcut({ key: "V", shiftKey: true, ctrlKey: false, metaKey: true }),
      true,
    );
    assert.equal(
      matchesVoiceToggleShortcut({ key: "v", shiftKey: false, ctrlKey: true, metaKey: false }),
      false,
    );
    assert.equal(
      matchesVoiceToggleShortcut({ key: "k", shiftKey: false, ctrlKey: true, metaKey: false }),
      false,
    );
    assert.equal(
      matchesVoiceToggleShortcut({ key: "v", shiftKey: true, ctrlKey: true, metaKey: false, altKey: true }),
      false,
    );
  });

  it("ignores editable targets", () => {
    assert.equal(isEditableKeyboardTarget(null), false);
    assert.equal(isEditableKeyboardTarget({ tagName: "DIV" } as EventTarget), false);
    assert.equal(isEditableKeyboardTarget({ tagName: "INPUT" } as EventTarget), true);
    assert.equal(isEditableKeyboardTarget({ tagName: "TEXTAREA" } as EventTarget), true);
    assert.equal(
      isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true } as EventTarget),
      true,
    );
    assert.equal(
      isEditableKeyboardTarget({
        tagName: "DIV",
        closest: (sel: string) => (sel.includes("input") ? {} : null),
      } as EventTarget),
      true,
    );
    assert.equal(typeof VOICE_TOGGLE_SHORTCUT.ariaKeyshortcuts, "string");
  });

  it("labels the mic with the shortcut", () => {
    assert.match(voiceMicAriaLabel(false, "Win"), /Start voice \(Ctrl\+Shift\+V\)/);
    assert.match(voiceMicAriaLabel(true, "MacIntel"), /Stop voice \(⌘⇧V\)/);
    assert.equal(voiceMicShortcutHint("Mac"), "⌘⇧V");
  });
});
