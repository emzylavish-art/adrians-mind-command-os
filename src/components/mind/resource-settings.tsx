import { useCallback, useEffect, useRef, useState } from "react";
import { readResourcePolicy, type ResourcePolicy } from "@/lib/mind/resource-policy";

type Operation = { operation_id: string; provider: string; model: string; status: string; estimated_usd_micros: number | null; calculated_usd_micros: number | null; pricing_revision: string | null };
/** Owner key remounts the form and invalidates responses from an earlier account. */
export function ResourceSettings({ ownerKey, accessToken }: { ownerKey: string | null; accessToken?: string | null }) {
  const [policy, setPolicy] = useState<ResourcePolicy | null>(null);
  const [revision, setRevision] = useState(0);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [prices, setPrices] = useState("{}");
  const epoch = useRef(0);
  const headers = useCallback(() => ({ "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }), [accessToken]);
  const load = useCallback(async () => {
    const generation = ++epoch.current;
    setPending(true); setNotice("");
    try {
      const response = await fetch("/api/mind/resources", { credentials: "include", headers: headers() });
      const result = await response.json();
      if (generation !== epoch.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "Spending policy could not be loaded.");
      const loaded = readResourcePolicy(result.policy);
      setPolicy(loaded); setPrices(JSON.stringify(loaded.prices, null, 2)); setRevision(result.revision); setOperations(result.operations ?? []);
    } catch (error) { if (generation === epoch.current) setNotice(error instanceof Error ? error.message : "Spending policy unavailable."); }
    finally { if (generation === epoch.current) setPending(false); }
  }, [headers]);
  useEffect(() => { setPolicy(null); setOperations([]); if (ownerKey) void load(); return () => { epoch.current += 1; }; }, [ownerKey, load]);
  async function save() {
    if (!policy || pending) return;
    const generation = epoch.current;
    setPending(true); setNotice("");
    try {
      const next = readResourcePolicy({ ...policy, prices: JSON.parse(prices) });
      const response = await fetch("/api/mind/resources", { method: "PUT", credentials: "include", headers: headers(), body: JSON.stringify({ policy: next, expectedRevision: revision }) });
      const result = await response.json();
      if (generation !== epoch.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "Policy was not saved.");
      setPolicy(next); setRevision(result.revision); setNotice("Spending policy saved. New dispatches use this account policy immediately.");
    } catch (error) { if (generation === epoch.current) setNotice(error instanceof Error ? error.message : "Policy was not saved."); }
    finally { if (generation === epoch.current) setPending(false); }
  }
  const numberField = (key: "maxCallsPerDay" | "maxConcurrent" | "maxTokensPerDay" | "maxDailyUsdMicros" | "maxCallUsdMicros", label: string, dollars = false) => policy && (
    <label className="grid gap-1 text-sm" key={key}>{label}<input className="min-h-11 rounded-panel border border-line bg-bg px-3" type="number" min={0} step={dollars ? "0.01" : "1"} value={policy[key] === null ? "" : Number(policy[key]) / (dollars ? 1_000_000 : 1)} placeholder={key === "maxCallsPerDay" || key === "maxConcurrent" ? undefined : "No limit"} onChange={(event) => setPolicy({ ...policy, [key]: event.target.value === "" ? null : Math.round(Number(event.target.value) * (dollars ? 1_000_000 : 1)) })} /></label>
  );
  return <section className="space-y-3 rounded-panel border border-line bg-surface p-4" aria-labelledby="resource-settings-title">
    <h3 id="resource-settings-title" className="font-semibold">Usage and spending</h3>
    <p className="text-sm text-muted">Account limits apply before new provider dispatches. Token reservations and versioned prices are estimates; provider billing has not been independently verified. Unknown usage stays unknown.</p>
    {!ownerKey ? <p>Sign in to manage account limits.</p> : !policy ? <button type="button" className="min-h-11" disabled={pending} onClick={() => void load()}>{pending ? "Loading policy…" : "Retry loading policy"}</button> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={policy.freeOnly} onChange={(event) => setPolicy({ ...policy, freeOnly: event.target.checked })} /> Free-only for this account</label>
      <div className="grid gap-3 sm:grid-cols-2">{numberField("maxCallsPerDay", "Maximum provider calls per day")}{numberField("maxConcurrent", "Concurrent provider calls")}{numberField("maxTokensPerDay", "Daily reserved token allowance")}{numberField("maxDailyUsdMicros", "Daily estimated allowance (USD)", true)}{numberField("maxCallUsdMicros", "Maximum estimated cost per call (USD)", true)}</div>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={policy.allowUnknownCost} onChange={(event) => setPolicy({ ...policy, allowUnknownCost: event.target.checked })} /> Allow unknown prices when no monetary cap is set</label>
      <details><summary className="min-h-11 content-center cursor-pointer">Versioned provider prices</summary><p className="my-2 text-sm text-muted">No prices are invented. Add prices from your provider contract as provider:model entries, with revision, inputUsdMicrosPerMillion and outputUsdMicrosPerMillion. Monetary caps block unpriced calls.</p><label className="grid gap-1 text-sm">Pricing table JSON<textarea rows={7} className="w-full rounded-panel border border-line bg-bg p-2 font-mono text-xs" value={prices} onChange={(event) => setPrices(event.target.value)} /></label></details>
      <div className="flex gap-3"><button type="submit" className="min-h-11 rounded-panel bg-accent px-4 text-accent-ink" disabled={pending}>{pending ? "Saving…" : "Save account limits"}</button><button type="button" className="min-h-11" disabled={pending} onClick={() => void load()}>Reload saved policy</button></div>
    </form>}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    <details><summary className="min-h-11 content-center cursor-pointer">Recent provider operations ({operations.length})</summary><ul className="mt-2 space-y-2 text-sm">{operations.map((operation) => <li key={operation.operation_id} className="rounded-panel border border-line p-2"><strong>{operation.provider}</strong> · {operation.model} · {operation.status}<p>Estimate: {operation.estimated_usd_micros === null ? "unknown" : `$${(Number(operation.estimated_usd_micros) / 1_000_000).toFixed(6)}`} · Calculated: {operation.calculated_usd_micros === null ? "unknown" : `$${(Number(operation.calculated_usd_micros) / 1_000_000).toFixed(6)}`} · Billing unverified</p></li>)}</ul></details>
  </section>;
}
