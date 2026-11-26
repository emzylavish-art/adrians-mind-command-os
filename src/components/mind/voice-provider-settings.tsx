import { useState } from "react";
import { useAccountPreferences } from "./account-preferences-context";
import { DEFAULT_VOICE_STAGES, loadVoiceStages, VOICE_STAGES_KEY, type VoiceStages } from "@/lib/mind/voice/provider-selection";
import type { PublicAiProvider } from "@/lib/mind/ai-provider-config.server";
import { VoiceReceiptHistory } from "./voice-stage-receipt";

export function VoiceProviderSettings({ providers = [], xaiAvailable, openaiAvailable }: { providers?: PublicAiProvider[]; xaiAvailable?: boolean; openaiAvailable?: boolean }) {
  const storage = useAccountPreferences();
  const [stages, setStages] = useState<VoiceStages>(() => loadVoiceStages(storage));
  const [notice, setNotice] = useState("");
  const choices = [
    { id: "xai", label: "Server xAI", disabled: xaiAvailable === false },
    { id: "openai", label: "Server OpenAI", disabled: openaiAvailable === false },
    ...providers.filter(row => row.hasKey && (row.host === "api.x.ai" || row.host === "api.openai.com")).map(row => ({ id: `custom:${row.id}`, label: `${row.label} · ${row.host}`, disabled: row.status === "credentials_rejected" || row.status === "billing_required" })),
  ];
  function save(next: VoiceStages) {
    try { storage.setItem(VOICE_STAGES_KEY, JSON.stringify(next)); setStages(next); setNotice("Voice stages saved for this account. No provider was called."); window.dispatchEvent(new Event("adrian-voice-stages-change")); }
    catch { setNotice("Voice settings could not be saved. Your previous selections remain in effect."); }
  }
  return <section className="settings-card space-y-3 rounded-panel p-4 text-sm" aria-label="Voice providers">
    <h3 className="font-semibold">Voice providers</h3>
    <label className="grid gap-1">Speech input<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={stages.inputProvider} onChange={event => save({ ...stages, inputProvider: event.target.value as VoiceStages["inputProvider"] })}>{choices.map(choice => <option key={choice.id} value={choice.id} disabled={choice.disabled}>{choice.label}{choice.disabled ? " · unavailable" : ""}</option>)}<option value="handy">Local Handy · requires configured local service</option>{!choices.some(choice => choice.id === stages.inputProvider) && stages.inputProvider !== "handy" ? <option value={stages.inputProvider} disabled>Saved input connection unavailable</option> : null}</select></label>
    <p><strong>Answer model:</strong> the model selected in chat. A text-only connected model can answer while a separate speech engine speaks.</p>
    <label className="grid gap-1">Speech output<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={stages.outputProvider} onChange={event => save({ ...stages, outputProvider: event.target.value as VoiceStages["outputProvider"] })}>{choices.map(choice => <option key={choice.id} value={choice.id} disabled={choice.disabled}>{choice.label}{choice.disabled ? " · unavailable" : ""}</option>)}{!choices.some(choice => choice.id === stages.outputProvider) ? <option value={stages.outputProvider} disabled>Saved output connection unavailable</option> : null}</select></label>
    <p className="text-xs text-muted">Selections are checked when used. xAI uses the selected xAI voice; OpenAI uses its implemented Alloy voice. Cloud speech can incur provider charges. There is no automatic provider fallback. Live realtime voice is a separate xAI capability.</p>
    <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => save(DEFAULT_VOICE_STAGES)}>Use xAI speech with chat model</button>
    {notice ? <p role="status" className="text-xs text-muted">{notice}</p> : null}
    <VoiceReceiptHistory />
  </section>;
}
