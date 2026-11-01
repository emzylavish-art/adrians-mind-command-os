import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldCloseSettingsOnEscape, shouldCloseSettingsOnOutsideClick } from "./settings-popover.ts";

describe("live-voice settings popover", () => {
  it("closes on Esc only when open", () => {
    assert.equal(shouldCloseSettingsOnEscape("Escape", true), true);
    assert.equal(shouldCloseSettingsOnEscape("Escape", false), false);
    assert.equal(shouldCloseSettingsOnEscape("Enter", true), false);
  });

  it("closes on outside click but not on gear/panel", () => {
    assert.equal(
      shouldCloseSettingsOnOutsideClick({
        settingsOpen: true,
        clickInsideSettings: false,
        clickOnSettingsButton: false,
      }),
      true,
    );
    assert.equal(
      shouldCloseSettingsOnOutsideClick({
        settingsOpen: true,
        clickInsideSettings: true,
        clickOnSettingsButton: false,
      }),
      false,
    );
    assert.equal(
      shouldCloseSettingsOnOutsideClick({
        settingsOpen: true,
        clickInsideSettings: false,
        clickOnSettingsButton: true,
      }),
      false,
    );
  });
});
