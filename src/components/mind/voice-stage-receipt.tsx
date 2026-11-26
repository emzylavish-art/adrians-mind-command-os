import { useEffect, useState } from "react";
import { readVoiceReceipts, type VoiceStagesReceipt } from "@/lib/mind/voice/stage-receipts";
import { useAccountPreferences } from "./account-preferences-context";

export function VoiceStageReceipt({ receipt }: { receipt: VoiceStagesReceipt }) {
  return <details className="my-2 rounded-panel border border-line p-3 text-xs">
    <summary className="min-h-11 cursor-pointer">Voice stages · playback {receipt.playback.replaceAll("_", " ")}</summary>
    <dl className="grid gap-2">
      {(["input", "answer", "output"] as const).map((stage) => <div key={stage}>
        <dt className="font-semibold">{stage === "input" ? "Speech input" : stage === "answer" ? "Answer model" : "Speech output"}</dt>
        <dd>Selected: {receipt[stage].selectedProvider ?? "Not requested"}. Result: {receipt[stage].state.replaceAll("_", " ")}. Returned provider: {receipt[stage].actualProvider ?? "Unreported"}{receipt[stage].actualModel ? ` · ${receipt[stage].actualModel}` : ""}. Observed responses: {receipt[stage].attempts}.</dd>
      </div>)}
    </dl>
    <p className="mt-2 text-muted">Adapter response attribution. This receipt does not independently verify the external provider or physical audio device.</p>
  </details>;
}

export function VoiceReceiptHistory() {
  const storage = useAccountPreferences();
  const [receipts, setReceipts] = useState(() => readVoiceReceipts(storage));
  useEffect(() => {
    const update = () => setReceipts(readVoiceReceipts(storage));
    update();
    window.addEventListener("adrian-voice-receipts-change", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("adrian-voice-receipts-change", update); window.removeEventListener("storage", update); };
  }, [storage]);
  return <details className="settings-card rounded-panel p-4 text-sm">
    <summary className="min-h-11 cursor-pointer">Recent voice receipts ({receipts.length})</summary>
    <p className="text-xs text-muted">Up to 20 operations for this account in this browser, including failed stages. Microphone recordings and transcripts are not stored here. Completed answers retain their stage receipt in the conversation.</p>
    {receipts.map((receipt) => <VoiceStageReceipt key={receipt.operationId} receipt={receipt} />)}
    {!receipts.length && <p>No stage receipts recorded in this browser.</p>}
  </details>;
}
