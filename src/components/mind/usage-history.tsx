import { useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import type { UsageEntry } from "@/lib/mind/types";
import { usageTotals } from "@/lib/mind/usage-ledger";

export function UsageHistory({ ownerId }: { ownerId: string | null }) {
  const [rows, setRows] = useState<UsageEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [next, setNext] = useState<number | null>(null);
  const [until, setUntil] = useState("");
  const generation = useRef(0);
  useEffect(() => { generation.current++; setRows([]); setNext(null); setBusy(false); setError(""); }, [ownerId]);
  async function load(offset = 0, all = false) {
    if (!ownerId || busy) return;
    const gen = ++generation.current;
    const to = offset ? until : new Date().toISOString();
    setUntil(to); setBusy(true); setError("");
    let cursor: number | null = offset;
    const accumulated: UsageEntry[] = [];
    try {
      do {
        const bearer = getBearerToken();
        const response = await fetch(`/api/mind/usage?offset=${cursor}&from=${encodeURIComponent(new Date(from + "T00:00:00Z").toISOString())}&to=${encodeURIComponent(to)}`, { credentials: "same-origin", cache: "no-store", headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
        const result = await response.json();
        if (gen !== generation.current) return;
        if (!response.ok || !result.ok || !Array.isArray(result.entries)) throw new Error("Usage history could not be loaded.");
        accumulated.push(...result.entries); cursor = typeof result.nextOffset === "number" ? result.nextOffset : null;
      } while (all && cursor !== null);
      if (all) {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ from, to, entries: accumulated, totals: usageTotals(accumulated), note: "Known tokens only. Missing usage is unknown; tokens are not a bill." }, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "adrian-usage-history.json"; link.click(); URL.revokeObjectURL(url);
      } else { setRows(previous => offset ? [...previous, ...accumulated] : accumulated); setNext(cursor); }
    } catch (caught) { if (gen === generation.current) setError(caught instanceof Error ? caught.message : "Usage history could not be loaded."); }
    finally { if (gen === generation.current) setBusy(false); }
  }
  const total = usageTotals(rows);
  return <section className="rounded-panel border border-line p-3 text-sm">
    <h3 className="font-semibold">Saved execution usage</h3>
    <p className="text-muted">Primary answers and helper calls are recorded separately on the server. Unknown usage is not zero or a verified charge. History begins with this version.</p>
    <div className="mt-2 flex flex-wrap items-center gap-2"><label>From (UTC) <input type="date" value={from} onChange={event => { setFrom(event.target.value); setRows([]); setNext(null); }} disabled={busy} /></label>
      <button type="button" className="min-h-11 rounded-panel border border-line px-3" disabled={busy || !ownerId || !from} onClick={() => void load()}>Load history</button>
      <button type="button" className="min-h-11 rounded-panel border border-line px-3" disabled={busy || !ownerId || !from} onClick={() => void load(0, true)}>Export selected period</button></div>
    {busy && <p role="status">Loading usage…</p>}{error && <p role="alert">{error}</p>}
    {rows.length > 0 && <><p className="mt-2">Loaded: {total.operations} executions · {total.knownPromptTokens} known input tokens · {total.knownCompletionTokens} known output tokens · {total.incomplete} incomplete usage reports.</p><ul className="max-h-80 overflow-auto">{rows.map(row => <li className="mt-2 break-words" key={row.id}>{row.at} · {row.stage ?? "answer"} · {row.provider} / {row.model} · {row.outcome} · input {row.promptTokens ?? "unknown"}, output {row.completionTokens ?? "unknown"}</li>)}</ul></>}
    {next !== null && <button type="button" className="min-h-11" disabled={busy} onClick={() => void load(next)}>Load more</button>}
  </section>;
}
