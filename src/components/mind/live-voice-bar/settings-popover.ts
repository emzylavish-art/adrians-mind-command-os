/** Pure helpers for live-voice settings popover (Esc / outside click). */

export function shouldCloseSettingsOnEscape(key: string, settingsOpen: boolean): boolean {
  return settingsOpen && key === "Escape";
}

export function shouldCloseSettingsOnOutsideClick(options: {
  settingsOpen: boolean;
  clickInsideSettings: boolean;
  clickOnSettingsButton: boolean;
}): boolean {
  if (!options.settingsOpen) return false;
  if (options.clickInsideSettings) return false;
  if (options.clickOnSettingsButton) return false;
  return true;
}
