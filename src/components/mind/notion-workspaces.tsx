import { useEffect, useState } from "react";
import { listNotionWorkspaces, selectNotionWorkspace } from "@/lib/mind/notion-workspaces";

export function NotionWorkspaces({ onAdd, onSelect }: { onAdd: () => void; onSelect: () => void }) {
  const [rows, setRows] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void listNotionWorkspaces().then((next) => { if (active) setRows(next); })
      .catch(() => { if (active) setError("Saved workspaces could not be loaded."); });
    return () => { active = false; };
  }, [attempt]);
  async function select(id: string) {
    setBusy(true);
    setError("");
    try {
      await selectNotionWorkspace({ data: { id } });
      setAttempt((n) => n + 1);
      onSelect();
    } catch { setError("The workspace selection could not be saved."); }
    finally { setBusy(false); }
  }
  return <div className="plugin-link__extra space-y-2">
    {rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-2">
      <span>{row.name}</span>
      {row.active ? <span>Selected</span> : <button type="button" disabled={busy} className="min-h-11 text-accent" onClick={() => void select(row.id)}>Use for new requests</button>}
    </div>)}
    <button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3" onClick={onAdd}>Add workspace</button>
    {error && <p role="alert">{error} <button onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Retry</button></p>}
  </div>;
}
