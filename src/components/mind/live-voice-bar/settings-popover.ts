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

/** Esc ends the call only when settings is closed and no modal is present. */
export function shouldEndCallOnEscape(options: {
  key: string;
  settingsOpen: boolean;
  callActive: boolean;
  modalOpenInDom: boolean;
}): boolean {
  if (options.key !== "Escape") return false;
  if (options.settingsOpen) return false;
  if (options.modalOpenInDom) return false;
  return options.callActive;
}
