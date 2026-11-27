import type { PreferenceStorage } from "./account-preferences.ts";

export const INTERFACE_KEY = "mind.interface.v2";
export const KEY_ACTIONS = [
  ["newChat", "Chat", "New chat", "Start a conversation"],
  ["branch", "Chat", "Branch chat", "Continue from a copy of the active conversation"],
  ["send", "Chat", "Send message", "Submit the focused composer"],
  ["background", "Chat", "Send in background", "Send the current draft to the selected thread"],
  ["queue", "Chat", "Queue prompt", "Hold the current draft for its conversation"],
  ["pets", "Companions", "Choose a Chat Bit", "Open companion settings"],
  ["documents", "Documents", "Open Library", "Browse your files"],
  ["build", "Build", "Open Build", "Open the building workspace"],
  ["settings", "Navigation", "Open Settings", "Search workspace preferences"],
] as const;
export type Action = typeof KEY_ACTIONS[number][0];
export type Appearance = { accent: string; foreground: string; background: string; font: string };
export type InterfacePrefs = { appearance: Appearance; sendKey: "enter" | "modified"; bindings: Partial<Record<Action, string>> };
export const defaultAppearance: Appearance = { accent: "", foreground: "", background: "", font: "System" };
export const defaultPrefs: InterfacePrefs = { appearance: defaultAppearance, sendKey: "enter", bindings: { newChat: "Mod+Shift+O", background: "Mod+Enter" } };
export const fonts = ["System", "Sans serif", "Serif", "Monospace"] as const;
export const fontValues: Record<string, string> = { "Sans serif": "Arial, sans-serif", Serif: "Georgia, serif", Monospace: "ui-monospace, monospace" };
export function readInterface(storage: Pick<PreferenceStorage, "getItem">): InterfacePrefs {
  try {
    const value = JSON.parse(storage.getItem(INTERFACE_KEY) || "null");
    if (!value || typeof value !== "object") return defaultPrefs;
    const appearance = { ...defaultAppearance };
    for (const key of ["accent", "foreground", "background"] as const) {
      if (/^#[\da-f]{6}$/i.test(value.appearance?.[key] || "")) appearance[key] = value.appearance[key];
    }
    if (fonts.includes(value.appearance?.font)) appearance.font = value.appearance.font;
    const prefs: InterfacePrefs = { appearance, bindings: {}, sendKey: value.sendKey === "modified" ? "modified" : "enter" };
    for (const [id] of KEY_ACTIONS) {
      const binding = typeof value.bindings?.[id] === "string" ? value.bindings[id] : defaultPrefs.bindings[id];
      if (binding === "") prefs.bindings[id] = "";
      else if (binding && /^(?:Mod\+(?:Alt\+)?|Alt\+)(?:Shift\+)?(?:[A-Z0-9]|Enter|F(?:[1-9]|1[0-2]))$/.test(binding) && !bindingConflict(id, binding, prefs)) prefs.bindings[id] = binding;
    }
    return prefs;
  } catch { return defaultPrefs; }
}
type Key = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; isComposing?: boolean; keyCode?: number };
export function chord(event: Key) {
  if (event.isComposing || event.keyCode === 229 || !/^(?:[a-z0-9]|Enter|F[1-9]|F1[0-2])$/i.test(event.key)) return "";
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return "";
  return [event.ctrlKey || event.metaKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean).join("+");
}
export function submitOnKey(event: Key, pref: InterfacePrefs["sendKey"]) {
  return event.key === "Enter" && !event.isComposing && event.keyCode !== 229 && !event.shiftKey && !event.altKey &&
    Boolean(event.ctrlKey || event.metaKey) === (pref === "modified");
}
export function bindingConflict(action: Action, combo: string, prefs: InterfacePrefs) {
  if (["Mod+K", "Mod+Shift+V", "Alt+P", "Mod+R", "Mod+T", "Mod+W", "Mod+L", "Mod+N", "Mod+Shift+T"].includes(combo)) return "This shortcut is already reserved.";
  if (combo === "Mod+Enter" && prefs.sendKey === "modified") return "This shortcut already sends the composer.";
  const conflict = KEY_ACTIONS.find(([id]) => id !== action && prefs.bindings[id] === combo);
  return conflict ? `This shortcut already runs ${conflict[2]}.` : "";
}
export function contrastRatio(a: string, b: string) {
  function luminance(hex: string) {
    const components = [1, 3, 5].map((offset) => {
      const n = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    });
    return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
  }
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
