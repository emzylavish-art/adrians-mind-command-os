/** Voice listen toggle shortcut: Ctrl/Cmd+Shift+V (does not clash with Ctrl/Cmd+K search). */
export const VOICE_TOGGLE_SHORTCUT = {
  key: "v",
  shiftKey: true,
  modKey: true as const,
  label: "Ctrl+Shift+V",
  macLabel: "⌘⇧V",
  ariaKeyshortcuts: "Control+Shift+V Meta+Shift+V",
};

function tagNameOf(target: EventTarget | null): string {
  if (!target || typeof target !== "object") return "";
  const el = target as { tagName?: unknown; nodeName?: unknown };
  const raw = typeof el.tagName === "string" ? el.tagName : typeof el.nodeName === "string" ? el.nodeName : "";
  return raw.toUpperCase();
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const tag = tagNameOf(target);
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const el = target as { isContentEditable?: unknown; closest?: (selector: string) => unknown };
  if (el.isContentEditable === true) return true;
  if (typeof el.closest === "function") {
    try {
      if (el.closest("input, textarea, select, [contenteditable='true']")) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function matchesVoiceToggleShortcut(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
}): boolean {
  if (event.altKey) return false;
  if (!event.shiftKey) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  return event.key.toLowerCase() === VOICE_TOGGLE_SHORTCUT.key;
}

export function voiceMicShortcutHint(platform?: string): string {
  const isMac = (platform ?? "").toLowerCase().includes("mac");
  return isMac ? VOICE_TOGGLE_SHORTCUT.macLabel : VOICE_TOGGLE_SHORTCUT.label;
}

export function voiceMicAriaLabel(listening: boolean, platform?: string): string {
  const action = listening ? "Stop voice" : "Start voice";
  return `${action} (${voiceMicShortcutHint(platform)})`;
}
