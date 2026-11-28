import { useState } from "react";
import { useAccountPreferences } from "./account-preferences-context";
import { loadModeInstructions, MODE_INSTRUCTIONS_KEY, MODE_INSTRUCTIONS_MAX, modeInstructionScopes, parseModeInstruction } from "@/lib/mind/mode-instructions";

const labels = {
  chat: ["Adrian Chat", "New text replies in Chat."],
  build: ["Build", "New plans and coding tasks in Work or Build."],
  companion: ["Companion", "New spoken answers and direct realtime voice sessions."],
};

export function ModeInstructionsSettings() {
  const storage = useAccountPreferences();
  const [draft, setDraft] = useState(() => loadModeInstructions(storage));
  const [notice, setNotice] = useState("");
  return <form className="settings-card grid gap-4 rounded-panel p-4" onSubmit={event => {
    event.preventDefault();
    const next = { ...draft };
    for (const mode of modeInstructionScopes) {
      const parsed = parseModeInstruction(draft[mode]);
      if (!parsed.ok) { setNotice(parsed.error); return; }
      next[mode] = parsed.text;
    }
    try {
      storage.setItem(MODE_INSTRUCTIONS_KEY, JSON.stringify(next));
      setDraft(next);
      setNotice(storage.persistent ? "Instructions saved for this account on this device." : "Instructions saved for this session.");
    } catch { setNotice("This device could not save your changes. Your edits are still here."); }
  }}>
    <div><h3 className="font-semibold">Custom instructions</h3><p className="text-sm text-muted">Each editor applies to its own mode. Guidance is sent to the provider handling that interaction.</p></div>
    {modeInstructionScopes.map(mode => <label key={mode} className="grid gap-1 text-sm">
      <span className="font-semibold">{labels[mode][0]}</span><span className="text-muted">{labels[mode][1]}</span>
      <textarea className="min-h-24 w-full resize-y rounded-panel border border-line bg-bg p-2" maxLength={MODE_INSTRUCTIONS_MAX} value={draft[mode]}
        onChange={event => { setNotice(""); setDraft(previous => ({ ...previous, [mode]: event.target.value })); }} />
    </label>)}
    <button className="min-h-11 w-fit rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" type="submit">Save instructions</button>
    {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
  </form>;
}
