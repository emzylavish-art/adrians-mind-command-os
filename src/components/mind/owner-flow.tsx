import { useState } from "react";
import { CANNOT_RUN, DEMO_COMMAND, DEMO_FILE, DEMO_WRITE, HOSTED_ACTIONS, canRunApproved, exactAction, type HostedActionId } from "@/lib/mind/owner-flow";

export function OwnerFlow(props: {
  halted: boolean;
  recording: boolean;
  recordingSeconds: number;
  onOpenSpeak: () => void;
  onToggleStop: () => void;
  onStopRecording: () => void;
}) {
  const [approved, setApproved] = useState<Partial<Record<HostedActionId, string>>>({});
  const [busy, setBusy] = useState<HostedActionId | null>(null);
  const [results, setResults] = useState<Partial<Record<HostedActionId, string>>>({});

  function setResult(id: HostedActionId, message: string) {
    setResults((prev) => ({ ...prev, [id]: message }));
  }

  async function run(id: HostedActionId) {
    const exact = exactAction(id);
    const gate = canRunApproved({ halted: props.halted, approved: approved[id] ?? null, exact });
    if (!gate.ok) {
      setResult(id, gate.message);
      return;
    }
    setBusy(id);
    try {
      if (id === "terminal") {
        const requested = await fetch("/api/mind/kimi/terminal", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: DEMO_COMMAND }),
        });
        const pending = (await requested.json()) as { ok?: boolean; error?: string; approval?: { id: string; token: string; command: string } };
        if (!pending.approval) {
          setResult(id, pending.error || "Terminal approval was not created. Nothing ran.");
          return;
        }
        const confirmed = await fetch("/api/mind/kimi/terminal", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: pending.approval.command, confirm: true, approvalId: pending.approval.id, token: pending.approval.token }),
        });
        const done = (await confirmed.json()) as { ok?: boolean; text?: string; error?: string };
        setResult(id, done.ok ? `Hosted terminal finished. ${done.text || "No output."}` : done.error || "Terminal did not finish. Nothing was marked complete.");
        return;
      }
      const body = id === "file_read"
        ? { operation: "read", path: DEMO_FILE }
        : id === "file_write"
          ? { operation: "write", path: DEMO_FILE, content: DEMO_WRITE }
          : { operation: "delete", path: DEMO_FILE, confirm: true };
      const response = await fetch("/api/mind/kimi/files", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { ok?: boolean; content?: string; error?: string; path?: string };
      if (!data.ok) {
        setResult(id, data.error || "The hosted action did not finish. Nothing was marked complete.");
        return;
      }
      setResult(id, id === "file_read" ? `Read ${data.path}. ${data.content || "Empty file."}` : id === "file_write" ? `Wrote ${data.path} in the hosted workspace.` : `Deleted ${data.path} from the hosted workspace.`);
    } catch {
      setResult(id, "The hosted action did not answer. Nothing was marked complete.");
    } finally {
      setBusy(null);
      setApproved((prev) => ({ ...prev, [id]: "" }));
    }
  }

  return (
    <section className="rounded-panel border border-line bg-surface p-4 md:p-5" data-testid="owner-flow" aria-label="Windows pairing">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Windows pairing</p>
          <h2 className="mt-1 text-lg font-semibold">Not installed</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted" data-testid="windows-not-installed">Desktop software is not built. It waits for your command. These four actions run only in the hosted workspace, and only after you approve each one.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm" onClick={props.onOpenSpeak} data-testid="owner-flow-speak">Open Speak</button>
          <button type="button" className="inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm" onClick={props.onToggleStop} data-testid="owner-flow-stop">{props.halted ? "Clear stop" : "Emergency stop"}</button>
        </div>
      </div>
      <p className="mt-3 text-sm" data-testid="owner-flow-recording" role="status">
        {props.recording ? `Recording this tab · ${props.recordingSeconds}s. Closing this tab stops it. It cannot continue after the tab closes.` : "Microphone is off. Open Speak and press the mic. Recording stays in this tab only. Closing the tab stops it."}
      </p>
      {props.recording ? <button type="button" className="mt-2 inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm" onClick={props.onStopRecording}>Stop recording</button> : null}
      <p className={"mt-3 text-sm font-semibold " + (props.halted ? "text-rose-300" : "text-emerald-300")} data-testid="owner-flow-halt">{props.halted ? "Emergency stop is on. EVE cannot clear it." : "Emergency stop is off. Only you can press it."}</p>
      <ul className="mt-4 grid gap-3">
        {HOSTED_ACTIONS.map((action) => (
          <li key={action.id} className="rounded-panel border border-line p-3" data-testid={`owner-action-${action.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{action.label}</p>
                <p className="text-xs text-muted">Hosted today. Your Windows PC is not touched.</p>
                <p className="text-xs text-muted">{exactAction(action.id)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={props.halted || busy === action.id} onClick={() => setApproved((prev) => ({ ...prev, [action.id]: exactAction(action.id) }))} data-testid={`approve-${action.id}`}>
                  {approved[action.id] === exactAction(action.id) ? "Approved" : "Approve"}
                </button>
                <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink disabled:opacity-50" disabled={props.halted || busy === action.id || approved[action.id] !== exactAction(action.id)} onClick={() => void run(action.id)} data-testid={`run-${action.id}`}>
                  {busy === action.id ? "Running" : "Run"}
                </button>
              </div>
            </div>
            {results[action.id] ? <p className="mt-2 text-sm" data-testid={`owner-result-${action.id}`}>{results[action.id]}</p> : null}
          </li>
        ))}
      </ul>
      <div className="mt-4" data-testid="cannot-run">
        <p className="text-xs uppercase tracking-wide text-muted">Cannot run</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {CANNOT_RUN.map((item) => <li key={item} className="rounded-full border border-line px-3 py-1 text-xs text-muted">{item}</li>)}
        </ul>
      </div>
    </section>
  );
}
