import { useEffect, useState } from "react";
import { bindingConflict, chord, contrastRatio, defaultAppearance, defaultPrefs, fonts, fontValues, INTERFACE_KEY, KEY_ACTIONS, readInterface, type Action, type Appearance, type InterfacePrefs } from "@/lib/mind/interface-preferences";
import { useAccountPreferences } from "./account-preferences-context";

export function useInterfaceSettings() {
  const storage = useAccountPreferences();
  const [prefs, setPrefs] = useState<InterfacePrefs>(defaultPrefs);
  const [saveError, setError] = useState("");
  useEffect(() => { setPrefs(readInterface(storage)); setError(""); }, [storage]);
  function save(next: InterfacePrefs) {
    try { storage.setItem(INTERFACE_KEY, JSON.stringify(next)); setPrefs(next); setError(""); return true; }
    catch { setError("Your browser could not save this preference."); return false; }
  }
  useEffect(() => {
    const root = document.documentElement.style;
    const appearance = prefs.appearance;
    const vars: Record<string, string> = { "--color-accent": appearance.accent, "--color-bg": appearance.background, "--color-fg": appearance.foreground,
      "--color-accent-ink": appearance.accent ? contrastRatio(appearance.accent, "#ffffff") > contrastRatio(appearance.accent, "#000000") ? "#ffffff" : "#000000" : "",
      "--font-sans": fontValues[appearance.font] || "", "--font-display": fontValues[appearance.font] || "" };
    for (const [key, value] of Object.entries(vars)) { if (value) root.setProperty(key, value); else root.removeProperty(key); }
    return () => { for (const key of Object.keys(vars)) root.removeProperty(key); };
  }, [prefs.appearance]);
  return { prefs, save, saveError };
}
type Settings = ReturnType<typeof useInterfaceSettings>;
const field = "min-h-11 rounded-panel border border-line bg-surface px-3";
export function SendKey({ prefs, save }: Settings) {
  const [review, setReview] = useState(false);
  const conflict = KEY_ACTIONS.find(([id]) => prefs.bindings[id] === "Mod+Enter");
  return <>
    <label className="settings-row"><span><strong>Send message</strong><small className="block text-muted">Shift + Enter always adds a new line.</small></span>
      <select aria-label="Send message key" className={field} value={prefs.sendKey} onChange={(event) => {
        const modified = event.target.value === "modified";
        setReview(modified && !!conflict);
        if (!modified || !conflict) save({ ...prefs, sendKey: modified ? "modified" : "enter" });
      }}><option value="enter">Enter</option><option value="modified">Ctrl / ⌘ + Enter</option></select>
    </label>
    {review && conflict && prefs.sendKey === "enter" && <div className="space-y-2">
      <p role="status">Ctrl / ⌘ + Enter currently runs {conflict[2]}. Move this shortcut to Send message?</p>
      <button type="button" className={field} onClick={() => {
        if (save({ ...prefs, sendKey: "modified", bindings: { ...prefs.bindings, [conflict[0]]: "" } })) setReview(false);
      }}>Move shortcut</button>{" "}
      <button type="button" className={field} onClick={() => setReview(false)}>Keep current shortcut</button>
    </div>}
  </>;
}

const appearancePresets: Record<string, Appearance> = {
  device: defaultAppearance,
  ocean: { accent: "#72d8ce", background: "#08181e", foreground: "#f0f9fa", font: "System" },
  paper: { accent: "#7c3b24", background: "#f7f2e9", foreground: "#27231c", font: "Serif" },
};

export function AppearanceSettings(settings: Settings & { light: boolean }) {
  const { prefs, save, light } = settings;
  const base = light ? { background: "#f5f7fb", foreground: "#0a0d14", accent: "#111827" } : { background: "#05070d", foreground: "#f4f6fb", accent: "#e8ecf5" };
  const [draft, setDraft] = useState<Appearance>(prefs.appearance);
  const [status, setStatus] = useState("");
  useEffect(() => { setDraft(prefs.appearance); }, [prefs.appearance]);
  function editAppearance(next: Appearance) {
    setDraft(next);
    setStatus("");
  }
  function applyAppearance(next: Appearance, message: string) {
    if (save({ ...prefs, appearance: next })) {
      setDraft(next);
      setStatus(message);
    } else {
      setStatus("");
    }
  }
  const fg = draft.foreground || base.foreground, bg = draft.background || base.background;
  const preset = Object.entries(appearancePresets).find(([, value]) =>
    value.accent === draft.accent && value.background === draft.background &&
    value.foreground === draft.foreground && value.font === draft.font
  )?.[0] ?? "custom";
  const contrast = contrastRatio(fg, bg);
  return <section className="settings-card rounded-panel p-4 text-sm space-y-3" aria-label="Theme colors and fonts">
    <h3>Theme colors and fonts</h3>
    <label className="settings-row">Theme preset<select className={field} value={preset} onChange={(e) => {
      editAppearance(appearancePresets[e.target.value]);
    }}><option value="device">Mind OS</option><option value="ocean">Midnight tide</option><option value="paper">Reading room</option>{preset === "custom" && <option value="custom" disabled>Custom</option>}</select></label>
    {(["accent", "background", "foreground"] as const).map((key) => <label className="settings-row capitalize" key={key}>{key}<span className="flex items-center gap-3"><code>{draft[key] || base[key]}</code><input type="color" value={draft[key] || base[key]} onChange={(e) => editAppearance({ ...draft, [key]: e.target.value })}/></span></label>)}
    <details><summary className="cursor-pointer py-3">Advanced</summary><label className="settings-row">Font<select className={field} value={draft.font} onChange={(e) => editAppearance({ ...draft, font: e.target.value })}>{fonts.map((font) => <option key={font}>{font}</option>)}</select></label></details>
    <div className="rounded-panel border border-line p-4" style={{color: fg, background: bg, fontFamily: fontValues[draft.font]}}><strong>Conversation preview</strong><p>Text contrast {contrast.toFixed(1)} to 1</p></div>
    <button type="button" className={field} disabled={contrast < 4.5} onClick={() => applyAppearance(draft, "Appearance saved.")}>Apply appearance</button>{" "}
    <button type="button" className={field} onClick={() => applyAppearance(defaultAppearance, "Default colors and font restored.")}>Restore default colors</button>
    <p role="status">{contrast < 4.5 ? "Increase text contrast to at least 4.5 to 1." : status}</p>
  </section>;
}
export function KeyboardSettings(settings: Settings) {
  const { prefs, save } = settings;
  const [query, setQuery] = useState(""), [group, setGroup] = useState("All"), [recording, setRecording] = useState<Action | null>(null), [status, setStatus] = useState("");
  const rows = KEY_ACTIONS.filter(([, category, title, detail]) => (group === "All" || group === category) && `${title} ${detail}`.toLowerCase().includes(query.toLowerCase()));
  const fixed = [["Navigation", "Search workspace", "Ctrl / ⌘ + K"], ["Voice", "Toggle voice capture", "Ctrl / ⌘ + Shift + V"], ["Other", "Shortcut reference", "? or Ctrl / ⌘ + /"]].filter(([category, title]) => (group === "All" || group === category) && title.toLowerCase().includes(query.toLowerCase()));
  return <section className="settings-card rounded-panel p-4 space-y-3 text-sm"><h3>Keyboard shortcuts</h3>
    <input type="search" className={field + " w-full"} aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={(e) => setQuery(e.target.value)}/>
    <div className="flex flex-wrap gap-2" aria-label="Shortcut filters">{["All","Chat","Voice","Companions","Navigation","Documents","Build","Other"].map((item) => <button type="button" key={item} aria-pressed={item === group} className={field} onClick={() => {setGroup(item);setRecording(null);}}>{item}</button>)}</div>
    {(group === "All" || group === "Chat") && "send message".includes(query.toLowerCase()) && <SendKey {...settings}/>}
    {rows.map(([id, , title, detail]) => <div className="settings-row flex-wrap" key={id}><span><strong>{title}</strong><small className="block text-muted">{detail}</small></span>
      <div className="flex gap-2"><button className={field} data-shortcut-capture={recording === id ? "true" : undefined} aria-label={`Edit shortcut for ${title}`} type="button" onClick={() => {setRecording(id);setStatus("Press a shortcut with Ctrl, Command or Alt. Escape cancels.");}} onBlur={() => setRecording(null)} onKeyDown={(e) => {
        if (recording !== id) return;
        if (e.key === "Tab") {setRecording(null);return;}
        e.preventDefault();e.stopPropagation();
        if (e.key === "Escape") {setRecording(null);setStatus("");return;}
        const value = chord(e.nativeEvent); if (!value) return;
        const error = bindingConflict(id,value,prefs); if (error) {setStatus(error);return;}
        if (save({ ...prefs, bindings: { ...prefs.bindings, [id]: value } })) {setRecording(null);setStatus(`${title} shortcut saved.`);}
      }}>{recording === id ? "Press keys…" : (prefs.bindings[id] || "Unassigned").replace("Mod", "Ctrl / ⌘")}</button>
      {prefs.bindings[id] && <button type="button" aria-label={`Clear shortcut for ${title}`} className={field} onClick={() => save({ ...prefs, bindings: { ...prefs.bindings, [id]: "" } })}>Clear</button>}</div></div>)}
    {fixed.map(([, title, keys]) => <div key={title} className="settings-row"><span>{title}</span><kbd>{keys}</kbd></div>)}
    {rows.length + fixed.length === 0 && <p>No matching shortcuts.</p>}<p role="status">{status}</p>
  </section>;
}
