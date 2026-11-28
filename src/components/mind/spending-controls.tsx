import { FinancialControls } from "@/components/mind/financial-controls";
import { useState } from "react";
import type { UsageEntry } from "@/lib/mind/types";
import type { DispatchPolicy } from "@/lib/mind/dispatch-controls.server";
import { getBearerToken } from "@/lib/auth/client";
export function SpendingControls({ usage }: { usage: UsageEntry[] }) {
  const [policy, setPolicy] = useState<DispatchPolicy | null>(null); const [limit, setLimit] = useState("1000"); const [paused, setPaused] = useState(false); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false);
  async function request(save = false) {
    if (busy) return; setBusy(true); setNotice("");
    try { const token = getBearerToken(); const response = await fetch("/api/mind/dispatch-policy", { credentials: "same-origin", method: save ? "POST" : "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(save ? { "content-type": "application/json" } : {}) }, body: save ? JSON.stringify({ paused, dailyLimit: Number(limit), expectedRevision: policy?.revision }) : undefined }); const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || "Request policy unavailable."); if (save) { setNotice("Policy saved. Refresh to see current usage before another change."); setPolicy(null); } else { setPolicy(result.policy); setLimit(String(result.policy.dailyLimit)); setPaused(result.policy.paused); } }
    catch (error) { setNotice(error instanceof Error ? error.message : "Policy unavailable."); } finally { setBusy(false); }
  }
  const groups = new Map<string, { calls: number; input: number; output: number; missingInput: number; missingOutput: number; unknown: number }>();
  for (const row of usage) {
    const key = `${row.provider || "Provider unreported"} · ${row.model}`;
    const total = groups.get(key) ?? { calls: 0, input: 0, output: 0, missingInput: 0, missingOutput: 0, unknown: 0 };
    total.calls++;
    if (row.promptTokens == null) total.missingInput++;
    else total.input += row.promptTokens;
    if (row.completionTokens == null) total.missingOutput++;
    else total.output += row.completionTokens;
    if (row.promptTokens == null || row.completionTokens == null) total.unknown++;
    groups.set(key, total);
  }
  function reportedTokens(sum: number, missing: number, calls: number) {
    if (missing === calls) return "Unreported";
    return missing ? `${sum} reported · ${missing} unreported` : sum;
  }
  return <section className="settings-card space-y-3 rounded-panel p-4 text-sm"><h3 className="font-semibold">Provider usage and limits</h3><p className="text-muted">Daily request counts reset at midnight UTC. Limits count dispatch attempts, including failures and helper calls. Token receipts describe reported usage; absent receipts and dollar cost are unknown. These limits cannot recall a request already sent.</p><button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void request()}>Refresh account policy</button>{policy && <><p>{policy.usedToday} requests reserved today · saved limit {policy.dailyLimit}</p><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />Pause new provider requests</label><label className="flex items-center gap-2">Daily request limit<input aria-label="Daily provider request limit" type="number" min={0} max={10000} value={limit} onChange={(e) => setLimit(e.target.value)} className="min-h-11 w-28 rounded-panel border border-line bg-bg px-2" /></label><button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void request(true)}>Save request policy</button></>}{notice && <p role="status">{notice}</p>}<div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th scope="col">Provider and model</th><th scope="col">Receipts</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Incomplete usage</th></tr></thead><tbody>{[...groups].map(([name, row]) => <tr key={name}><td className="p-2">{name}</td><td>{row.calls}</td><td>{reportedTokens(row.input, row.missingInput, row.calls)}</td><td>{reportedTokens(row.output, row.missingOutput, row.calls)}</td><td>{row.unknown}</td></tr>)}</tbody></table></div><FinancialControls /></section>;
}
