import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getBearerToken } from "@/lib/auth/client";
import type { OperationalHealth, OperationalState } from "@/lib/mind/dashboard/operational-health";

const labels: Record<OperationalState, string> = { observed: "Observed", needs_attention: "Needs attention", unverified: "Unverified", unavailable: "Unavailable" };
const timestamp = (value: string | null) => value ? new Date(value).toLocaleString() : "No verified timestamp";
const duration = (value: number | null) => value == null ? "Unmeasured" : value >= 60_000 ? `${Math.round(value / 60_000)} min` : `${Math.round(value)} ms`;

export function OperationalHealthCenter() {
  const { user, isPending } = useCurrentUserState();
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{ ownerId: string; health: OperationalHealth } | null>(null);
  const health = snapshot && snapshot.ownerId === user?.id ? snapshot.health : null;
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    setSnapshot(null);
    setFailure("");
    if (!user?.id) { setLoading(false); return; }
    const ownerId = user.id;
    let active = true;
    const controller = new AbortController();
    const bearer = getBearerToken();
    setLoading(true);
    const timeout = setTimeout(() => { controller.abort(); if (active) { setFailure("Operational health did not answer in time. Refresh to try again."); setLoading(false); } }, 15_000);
    void fetch("/api/mind/dashboard/health", { credentials: "include", cache: "no-store", signal: controller.signal, headers: bearer ? { authorization: `Bearer ${bearer}` } : {} })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to view your operational health." : "Operational health could not be loaded.");
        const data = await response.json() as { ok: boolean; health?: OperationalHealth };
        if (!data.ok || !data.health || !Array.isArray(data.health.components)) throw new Error("Operational health returned an invalid response.");
        if (active && !controller.signal.aborted && bearer === getBearerToken()) setSnapshot({ ownerId, health: data.health });
      })
      .catch(() => { if (active && !controller.signal.aborted) setFailure("Operational health could not be loaded. Refresh to try again."); })
      .finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [user?.id, revision]);
  if (isPending || !user) return null;
  const storageReadable = health?.components.find(row => row.id === "storage")?.state === "observed";
  return <section className="mx-auto max-w-5xl space-y-3 p-4 md:p-6" aria-labelledby="operational-health-title">
    <div className="flex items-center justify-between gap-3"><h2 id="operational-health-title" className="text-lg font-semibold">Operational health</h2><button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-50" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? "Checking…" : "Refresh health"}</button></div>
    <p className="text-sm text-muted">Readiness and saved execution receipts for your account. This check makes no provider requests and starts no work.</p>
    {failure && <p role="alert" className="text-sm text-danger">{failure}</p>}
    {loading && <p role="status" className="text-sm text-muted">Reading saved operational evidence…</p>}
    {health && <>
      <p className="text-xs text-muted">Checked {timestamp(health.generatedAt)} · Deployment revision: <code>{health.revision ?? "Not reported by this runtime"}</code></p>
      <div className="grid gap-3 sm:grid-cols-2">{health.components.map(row => <article key={row.id} className="rounded-panel border border-line p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{row.label}</h3><span className={row.state === "observed" ? "text-sm text-accent" : row.state === "needs_attention" || row.state === "unavailable" ? "text-sm text-amber-600" : "text-sm text-muted"}>{labels[row.state]}</span></div>
        <p className="mt-2 text-sm text-muted">{row.detail}</p><p className="mt-2 text-xs text-muted">{row.basis.replaceAll("_", " ")} · {timestamp(row.lastVerifiedAt)}</p>
      </article>)}</div>
      {storageReadable && <details className="rounded-panel border border-line p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">Recorded performance and run evidence</summary>
        <p className="my-3 text-sm text-muted">{health.population} Unknown and pending outcomes are excluded from the acknowledgment rate and latency percentiles. {health.metrics.invalidTiming > 0 ? `${health.metrics.invalidTiming} receipts have invalid timing and are excluded.` : ""}</p>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-muted">Acknowledged / failed</dt><dd>{health.metrics.acknowledged} / {health.metrics.failed}</dd></div>
          <div><dt className="text-muted">Unknown / pending</dt><dd>{health.metrics.unknown} / {health.metrics.pending}</dd></div>
          <div><dt className="text-muted">Acknowledgment rate</dt><dd>{health.metrics.requestSuccessRate == null ? "Unmeasured" : `${Math.round(health.metrics.requestSuccessRate * 100)}%`}</dd></div>
          <div><dt className="text-muted">Median / p95 operation latency</dt><dd>{duration(health.metrics.medianLatencyMs)} / {duration(health.metrics.p95LatencyMs)}</dd><dd className="text-xs text-muted">{health.metrics.latencySampleCount} measured operations</dd></div>
          <div><dt className="text-muted">Finished steps / terminal runs</dt><dd>{health.metrics.completedRuns} / {health.metrics.terminalRuns}</dd><dd className="text-xs text-muted">{health.metrics.verifiedObjectives} objectives explicitly verified</dd></div>
          <div><dt className="text-muted">Oldest queued run</dt><dd>{health.metrics.oldestQueueAgeMs == null ? "No queued run recorded" : duration(health.metrics.oldestQueueAgeMs)}</dd></div>
        </dl>
        <p className="my-3 text-xs text-muted">Latest saved workspace update: {timestamp(health.metrics.lastSnapshotWriteAt)}. Historical acknowledgments do not verify a new write.</p>
        {health.history.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="mb-2 text-left text-muted">Latest retained operation receipts, up to 50</caption><thead><tr><th className="p-2">Time</th><th className="p-2">Provider</th><th className="p-2">Outcome</th><th className="p-2">Latency</th></tr></thead><tbody>{health.history.map(row => <tr key={row.operationId} className="border-t border-line"><td className="p-2">{timestamp(row.at)}</td><td className="p-2">{row.provider ?? "Not recorded"}</td><td className="p-2">{row.state}</td><td className="p-2">{duration(row.latencyMs)}</td></tr>)}</tbody></table></div>}
      </details>}
    </>}
  </section>;
}
