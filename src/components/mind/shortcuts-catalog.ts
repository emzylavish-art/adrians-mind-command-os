/** Honest catalog of shortcuts that exist in code. No decorative fakes. */

export type ShortcutGroupId = "navigation" | "composer" | "chat" | "voice";

export type ShortcutEntry = {
  keys: string;
  action: string;
  source: string;
};

export type ShortcutGroup = {
  id: ShortcutGroupId;
  label: string;
  entries: ShortcutEntry[];
  emptyNote?: string;
};

/** Shortcuts present on visual/polish base without the Pass-6 host. */
export const BASE_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: "navigation",
    label: "Navigation",
    entries: [
      {
        keys: "Ctrl/⌘ K",
        action: "Open command palette and focus search",
        source: "command-app.tsx keydown",
      },
      {
        keys: "Esc",
        action: "Close command palette",
        source: "command-app.tsx keydown",
      },
    ],
  },
  {
    id: "composer",
    label: "Composer",
    entries: [
      {
        keys: "Enter",
        action: "Submit the focused composer / form (native form submit)",
        source: "command-app.tsx forms with type=submit",
      },
    ],
  },
  {
    id: "chat",
    label: "Chat",
    entries: [
      {
        keys: "Enter",
        action: "Send when the chat composer form is focused",
        source: "ChatPane form onSubmit",
      },
    ],
  },
  {
    id: "voice",
    label: "Voice",
    entries: [],
    emptyNote: "No dedicated voice keyboard shortcuts on this branch (voice worktrees also only register Ctrl/⌘ K + Esc).",
  },
];

/** Extra bindings registered by ShortcutSheetHost when mounted. */
export const SHEET_HOST_SHORTCUTS: ShortcutEntry[] = [
  {
    keys: "?",
    action: "Open keyboard shortcut help (ignored while typing in inputs)",
    source: "shortcut-sheet.tsx ShortcutSheetHost",
  },
  {
    keys: "Ctrl/⌘ /",
    action: "Open keyboard shortcut help",
    source: "shortcut-sheet.tsx ShortcutSheetHost",
  },
  {
    keys: "Esc",
    action: "Close keyboard shortcut help when open",
    source: "shortcut-sheet.tsx ShortcutSheetHost",
  },
];

export function shortcutGroupsForSheet(opts: { hostMounted: boolean }): ShortcutGroup[] {
  const groups = BASE_SHORTCUT_GROUPS.map((g) => ({ ...g, entries: [...g.entries] }));
  if (opts.hostMounted) {
    const nav = groups.find((g) => g.id === "navigation");
    if (nav) nav.entries = [...nav.entries, ...SHEET_HOST_SHORTCUTS];
  }
  return groups;
}
