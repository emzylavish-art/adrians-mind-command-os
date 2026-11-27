import { useEffect, useState } from "react";
import { PanelLeft, Pin, type LucideIcon } from "lucide-react";
import { useAccountPreferences } from "./account-preferences-context";
import { ActionOverlay, rememberMenuAnchor } from "./conversation-menu";
import { readWorkspaceShortcuts, WORKSPACE_SHORTCUTS_KEY } from "@/lib/mind/workspace-shortcuts";

type Shortcut = { id: string; label: string; icon: LucideIcon; current: boolean; open: () => void };
const defaults = ["command", "build", "speak", "dashboard", "connected", "controls"];

export function WorkspaceShortcuts({ items, collapsed, onToggle }: { items: Shortcut[]; collapsed: boolean; onToggle: () => void }) {
  const preferences = useAccountPreferences();
  const [pinned, setPinned] = useState(defaults);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
  const allowedKey = items.map(item => item.id).join("|");
  useEffect(() => {
    try { setPinned(readWorkspaceShortcuts(preferences.getItem(WORKSPACE_SHORTCUTS_KEY), allowedKey.split("|"), defaults)); }
    catch { setPinned(defaults); }
    setDraft(null);
  }, [preferences, allowedKey]);

  const save = () => {
    if (!draft) return;
    try {
      const saved = JSON.stringify(draft);
      preferences.setItem(WORKSPACE_SHORTCUTS_KEY, saved);
      if (preferences.getItem(WORKSPACE_SHORTCUTS_KEY) !== saved) throw new Error();
      setPinned(draft);
      setDraft(null);
    } catch { setNotice("This browser could not save your shortcuts. The previous selection is intact."); }
  };

  return <nav className="workspace-shortcuts" aria-label="Workspace shortcuts">
    <button id="workspace-sidebar-visibility" type="button" title={collapsed ? "Open sidebar" : "Hide sidebar"} aria-label={collapsed ? "Open sidebar" : "Hide sidebar"} aria-controls="workspace-sidebar" aria-expanded={!collapsed} onClick={onToggle}><PanelLeft size={20} aria-hidden="true" /></button>
    <div className="workspace-shortcut-items">
      {pinned.map(id => {
        const item = items.find(choice => choice.id === id);
        return item && <button key={id} type="button" title={item.label} aria-label={`Go to ${item.label}`} aria-current={item.current ? "page" : undefined} onClick={item.open}><item.icon size={20} aria-hidden="true" /></button>;
      })}
    </div>
    <button type="button" title="Customize shortcuts" aria-label="Customize shortcuts" aria-haspopup="dialog" onClick={event => { rememberMenuAnchor(event.currentTarget); setNotice(""); setDraft([...pinned]); }}><Pin size={19} aria-hidden="true" /></button>
    {draft && <ActionOverlay label="Customize shortcuts" title="Customize shortcuts" onClose={() => setDraft(null)}>
      <fieldset className="max-h-[min(50svh,22rem)] space-y-1 overflow-y-auto px-2">
        <legend className="sr-only">Pinned workspace destinations</legend>
        {items.map(item => <label key={item.id} className="flex min-h-11 items-center gap-3 rounded-panel px-2 text-sm hover:bg-surface">
          <input type="checkbox" checked={draft.includes(item.id)} onChange={event => setDraft(event.target.checked ? [...draft, item.id] : draft.filter(id => id !== item.id))} />
          <span>{item.label}</span>
        </label>)}
      </fieldset>
      {notice && <p role="alert" className="p-2 text-sm">{notice}</p>}
      <div className="flex flex-wrap justify-end gap-2 p-2">
        <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setDraft([...defaults])}>Restore defaults</button>
        <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setDraft(null)}>Cancel</button>
        <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm text-accent-ink" onClick={save}>Save shortcuts</button>
      </div>
    </ActionOverlay>}
  </nav>;
}
