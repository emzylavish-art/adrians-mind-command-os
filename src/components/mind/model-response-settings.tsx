import { useState } from "react";
import { useAccountPreferences } from "./account-preferences-context";
import { ANSWER_BUDGET_PRESETS, loadModelControls, MODEL_CONTROLS_KEY, type ModelControls } from "@/lib/mind/model-tiers";

export function ModelResponseSettings({ reasoningEnabled = false }: { reasoningEnabled?: boolean }) {
  const storage = useAccountPreferences();
  const [value, setValue] = useState(() => loadModelControls(storage));
  const [notice, setNotice] = useState("");
  function save(next: ModelControls) {
    try { storage.setItem(MODEL_CONTROLS_KEY, JSON.stringify(next)); setValue(next); setNotice("Response controls saved for this account. They apply to the next request."); }
    catch { setNotice("Response controls could not be saved."); }
  }
  return <section className="settings-card space-y-3 rounded-panel p-4 text-sm" aria-label="Answer budgets">
    <h3 className="font-semibold">Answer and reasoning</h3>
    <label className="grid gap-1">Maximum answer tokens<select value={value.answerTokens || ""} className="min-h-11 rounded-panel border border-line bg-bg px-3" onChange={event => save({ ...value, answerTokens: event.target.value ? Number(event.target.value) : undefined })}><option value="">Keep tier default</option>{ANSWER_BUDGET_PRESETS.map(tokens => <option key={tokens} value={tokens}>{tokens.toLocaleString()}</option>)}</select></label>
    <label className="grid gap-1">Reasoning effort<select disabled={!reasoningEnabled} value={value.reasoning || "auto"} className="min-h-11 rounded-panel border border-line bg-bg px-3" onChange={event => save({ ...value, reasoning: event.target.value as ModelControls["reasoning"] })}>{["auto", "none", "low", "medium", "high", "xhigh"].map(level => <option key={level} value={level}>{level}</option>)}</select></label>
    <p className="text-xs text-muted">Larger answer limits may use more tokens and cost more. Reasoning effort applies only to a supported selected Grok model; it is separate from answer length. No default budget is raised automatically.</p>
    {notice ? <p role="status" className="text-xs text-muted">{notice}</p> : null}
  </section>;
}
