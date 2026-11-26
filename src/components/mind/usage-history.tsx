import { useEffect, useMemo, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { groupUsage, loadUsagePeriod, MAX_USAGE_PERIOD_ROWS, usageChannel, usageDateRange, usageExport, usageTotals, type UsageGrouping, type UsagePage, type UsagePeriod } from "@/lib/mind/usage-ledger";

type RetentionReview = { before: string; matching: number; batchLimit: number; ownerId: string };
type UsageResponse = Partial<UsagePage & Omit<RetentionReview, "ownerId">> & { ok?: boolean; error?: string; deleted?: number; remaining?: number | null };

export function UsageHistory({ ownerId }: { ownerId: string | null }) {
  const [period, setPeriod] = useState<UsagePeriod | null>(null);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [through, setThrough] = useState(() => new Date().toISOString().slice(0, 10));
  const [grouping, setGrouping] = useState<UsageGrouping>("day");
  const [beforeDate, setBeforeDate] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [review, setReview] = useState<RetentionReview | null>(null);
  const generation = useRef(0);
  const requestFlight = useRef<AbortController | null>(null);
  const ownerRef = useRef(ownerId); ownerRef.current = ownerId;
  useEffect(() => {
    generation.current++; requestFlight.current?.abort(); requestFlight.current = null;
    setPeriod(null); setLoadedOwner(null); setBusy(false); setError(""); setNotice(""); setReview(null); setConfirmation("");
    return () => { requestFlight.current?.abort(); };
  }, [ownerId]);

  function start() {
    if (!ownerId || requestFlight.current) return null;
    const controller = new AbortController(); requestFlight.current = controller;
    const gen = ++generation.current;
    setBusy(true); setError(""); setNotice("");
    return { owner: ownerId, gen, controller, current: () => ownerRef.current === ownerId && gen === generation.current && !controller.signal.aborted };
  }
  function finish(task: NonNullable<ReturnType<typeof start>>) {
    if (!task.current()) return;
    requestFlight.current = null; setBusy(false);
  }
  async function request(url: string, signal: AbortSignal, init: RequestInit = {}): Promise<UsageResponse> {
    const bearer = getBearerToken();
    const response: Response = await fetch(url, { ...init, signal, credentials: "same-origin", cache: "no-store", headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...init.headers } });
    const result: UsageResponse = await response.json();
    if (!response.ok || !result.ok) throw new Error(typeof result.error === "string" ? result.error : "Usage history is unavailable.");
    return result;
  }
  async function load() {
    const range = usageDateRange(from, through);
    if (!range) { setError("Choose a valid UTC period ending today or earlier."); return; }
    const task = start(); if (!task) return;
    setPeriod(null); setLoadedOwner(null);
    try {
      const loaded = await loadUsagePeriod(async input => {
        const query = new URLSearchParams({ ownerId: task.owner, offset: String(input.offset), limit: String(input.limit), from: input.from, to: input.to });
        const result = await request(`/api/mind/usage?${query}`, task.controller.signal);
        if (!task.current()) throw new Error("The account changed while loading usage.");
        if (!Array.isArray(result.entries) || typeof result.from !== "string" || typeof result.to !== "string" || result.nextOffset !== null && typeof result.nextOffset !== "number") throw new Error("The usage page was incomplete. Reload the period.");
        return { entries: result.entries, from: result.from, to: result.to, nextOffset: result.nextOffset };
      }, range);
      if (task.current()) { setPeriod(loaded); setLoadedOwner(task.owner); }
    } catch (caught) { if (task.current()) setError(caught instanceof Error ? caught.message : "Usage history could not be loaded."); }
    finally { finish(task); }
  }
  function exportLoaded() {
    if (!period || loadedOwner !== ownerId) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(usageExport(period), null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `adrian-usage-${period.complete ? "complete" : "partial"}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function reviewRetention() {
    const task = start(); if (!task) return;
    setReview(null); setConfirmation("");
    try {
      const query = new URLSearchParams({ ownerId: task.owner, retentionBefore: beforeDate });
      const result = await request(`/api/mind/usage?${query}`, task.controller.signal);
      if (typeof result.before !== "string" || typeof result.matching !== "number" || typeof result.batchLimit !== "number") throw new Error("Retention review was incomplete. Try again.");
      if (task.current()) setReview({ before: result.before, matching: result.matching, batchLimit: result.batchLimit, ownerId: task.owner });
    } catch (caught) { if (task.current()) setError(caught instanceof Error ? caught.message : "Retention review is unavailable."); }
    finally { finish(task); }
  }
  async function deleteReviewed() {
    if (!review || review.ownerId !== ownerId || confirmation !== beforeDate || review.before.slice(0, 10) !== beforeDate) return;
    const task = start(); if (!task) return;
    // A lost response must require a fresh review before another destructive batch.
    setReview(null); setConfirmation("");
    try {
      const result = await request("/api/mind/usage", task.controller.signal, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: task.owner, before: beforeDate, confirmation: `DELETE_USAGE_BEFORE:${review.before}` }) });
      if (!task.current()) return;
      if (typeof result.deleted !== "number" || typeof result.before !== "string" || result.remaining !== null && typeof result.remaining !== "number") throw new Error("Deletion outcome was incomplete. Review retention again before retrying.");
      setPeriod(null); setLoadedOwner(null); setReview(null); setConfirmation("");
      setNotice(`Deleted ${result.deleted} saved ledger receipts. ${result.remaining === null ? "The remaining count could not be confirmed; review again before another deletion." : result.remaining > 0 ? `${result.remaining} matching receipts remain. Review and confirm another batch to continue.` : "No matching receipts remain."}`);
      window.dispatchEvent(new CustomEvent("adrian-usage-retention", { detail: { ownerId: task.owner, before: result.before } }));
    } catch (caught) { if (task.current()) setError(caught instanceof Error ? caught.message : "Deletion was not confirmed. Reload the retention review before retrying."); }
    finally { finish(task); }
  }
  const visible = loadedOwner === ownerId ? period : null;
  const total = useMemo(() => usageTotals(visible?.entries ?? []), [visible]);
  const groups = useMemo(() => groupUsage(visible?.entries ?? [], grouping), [visible, grouping]);
  const rangeChanged = () => { setPeriod(null); setLoadedOwner(null); };
  const control = "min-h-11 rounded-panel border border-line px-3";
  return <section className="rounded-panel border border-line p-3 text-sm">
    <h3 className="font-semibold">Saved execution usage</h3>
    <p className="text-muted">Answers and helper calls are separate execution stages. Unknown usage is not zero or a verified charge. Historical channels without attribution remain unknown.</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label>From (UTC) <input type="date" value={from} onChange={event => { setFrom(event.target.value); rangeChanged(); }} disabled={busy} /></label>
      <label>Through (UTC) <input type="date" value={through} onChange={event => { setThrough(event.target.value); rangeChanged(); }} disabled={busy} /></label>
      <button type="button" className={control} disabled={busy || !ownerId || !from || !through} onClick={() => void load()}>Load selected period</button>
      <button type="button" className={control} disabled={busy || !visible} onClick={exportLoaded}>{visible?.complete === false ? "Export loaded subset" : "Export loaded period"}</button>
    </div>
    <p className="mt-1 text-xs text-muted">Loads up to {MAX_USAGE_PERIOD_ROWS.toLocaleString()} receipts per period. Choose a narrower period if more records remain. Totals count known tokens, not billing amounts.</p>
    {busy && <p role="status">Working on saved usage…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {visible && <>
      <p className="mt-2" role="status">{visible.complete ? "Complete saved period" : "Partial loaded period — more receipts remain"}: {visible.from} through {visible.to}. {total.operations} execution stages · {total.knownPromptTokens} known input tokens · {total.knownCompletionTokens} known output tokens · {total.incomplete} incomplete usage reports.</p>
      <label className="mt-2 block">Group loaded totals <select className={control} value={grouping} onChange={event => setGrouping(event.target.value as UsageGrouping)}><option value="day">UTC day</option><option value="month">UTC month</option><option value="provider">Provider</option><option value="channel">Channel</option></select></label>
      <div className="max-h-64 overflow-auto"><table className="w-full text-left"><caption className="sr-only">{visible.complete ? "Selected period" : "Loaded subset"} usage by {grouping}</caption><thead><tr><th scope="col">{grouping}</th><th scope="col">Stages</th><th scope="col">Known input</th><th scope="col">Known output</th><th scope="col">Incomplete</th></tr></thead><tbody>{groups.map(group => <tr key={group.key}><th scope="row" className="break-words">{group.key}</th><td>{group.operations}</td><td>{group.knownPromptTokens}</td><td>{group.knownCompletionTokens}</td><td>{group.incomplete}</td></tr>)}</tbody></table></div>
      <details className="mt-2"><summary>Execution receipts</summary>{visible.entries.length > 200 && <p className="text-muted">Showing the first 200 receipts. Export includes all {visible.entries.length} loaded receipts.</p>}<ul className="max-h-80 overflow-auto">{visible.entries.slice(0, 200).map(row => <li className="mt-2 break-words" key={row.operationId ? `${row.operationId}/${row.stage ?? "answer"}` : row.id}>{row.at} · {usageChannel(row)} / {row.stage ?? "answer"} · {row.provider} / {row.model} · {row.outcome}{row.executionState && ` · runtime ${row.executionState}`}{row.providerDispatch && ` · provider ${row.providerDispatch}`} · input {row.promptTokens ?? "unknown"}, output {row.completionTokens ?? "unknown"}{row.operationId && <span className="block text-xs text-muted">Operation {row.operationId}</span>}</li>)}</ul></details>
    </>}
    <details className="mt-3 border-t border-line pt-2"><summary>Ledger retention</summary>
      <p className="mt-2 text-muted">No automatic deletion is enabled. Review a UTC cutoff to permanently remove older saved ledger receipts in batches. Recent Activity has a separate cache. Export any history you want to keep first.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2"><label>Older than (UTC) <input type="date" value={beforeDate} disabled={busy} onChange={event => { setBeforeDate(event.target.value); setReview(null); setConfirmation(""); }} /></label><button type="button" className={control} disabled={busy || !ownerId || !beforeDate} onClick={() => void reviewRetention()}>Review deletion</button></div>
      {review && review.ownerId === ownerId && <div className="mt-2"><p>{review.matching} saved receipts are older than {review.before}. This action deletes up to {review.batchLimit} receipts from the signed-in account. Turn deduplication records stay protected.</p><label className="mt-2 block">Type {beforeDate} to confirm this cutoff <input value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label><button type="button" className={control} disabled={busy || review.matching === 0 || confirmation !== beforeDate} onClick={() => void deleteReviewed()}>Permanently delete reviewed batch</button></div>}
    </details>
  </section>;
}
