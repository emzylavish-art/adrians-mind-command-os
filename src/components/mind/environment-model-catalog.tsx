import type { EnvironmentModelCatalog, EnvironmentProvider } from "@/lib/mind/environment-model-catalog";

export function EnvironmentModelCatalogPanel({ catalogs, busy, onRefresh }: { catalogs: EnvironmentModelCatalog[]; busy: boolean; onRefresh: (provider: EnvironmentProvider) => void }) {
  const configured = catalogs.filter(row => row.configured);
  if (!configured.length) return null;
  return <details className="mt-4 rounded-panel border border-line p-3" data-testid="environment-model-catalog">
    <summary className="cursor-pointer font-semibold">Models from server connections</summary>
    <p className="mt-2 text-xs text-muted">Refresh reads provider model metadata only. It does not generate a reply or verify inference. Observations expire after 24 hours; a missing or stale selection is preserved until you review it.</p>
    <div className="mt-3 grid gap-3">{configured.map(row => <article key={row.provider} className="min-w-0 rounded-panel border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">{row.provider === "grok" ? "Grok" : row.provider} · {row.state}</h4><button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" disabled={busy || !row.discoverySupported} onClick={() => onRefresh(row.provider)}>Refresh models</button></div>
      <p className="mt-1 text-xs text-muted">{row.checkedAt ? `Metadata checked ${new Date(row.checkedAt).toLocaleString()}.` : "No current-account catalogue has been observed."} Inference unverified.</p>
      {!row.discoverySupported ? <p className="mt-1 text-xs text-muted">This legacy runner has no model-list adapter. It remains configured and unverified; no automatic probe is made.</p> : null}
      {row.error ? <p role="status" className="mt-2 break-words text-xs text-warning">{row.error}</p> : null}
      {row.models.length ? <p className="mt-2 break-words text-xs text-muted">{row.models.slice(0, 30).join(" · ")}{row.models.length > 30 ? ` · ${row.models.length - 30} more listed models` : ""}</p> : row.state === "catalogued" ? <p className="mt-2 text-xs text-muted">The complete catalogue listed no compatible model.</p> : null}
    </article>)}</div>
  </details>;
}
