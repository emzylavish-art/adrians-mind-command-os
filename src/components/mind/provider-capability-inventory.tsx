import { PROVIDER_MODALITIES, providerInventory } from "@/lib/mind/provider-inventory";

export function ProviderCapabilityInventory(props: Parameters<typeof providerInventory>[0]) {
  const rows = providerInventory(props);
  return <section className="settings-card space-y-3 rounded-panel p-4" aria-labelledby="provider-capability-title">
    <h3 id="provider-capability-title" className="font-semibold">Provider capabilities</h3>
    <p className="text-sm text-muted">Vision refers to the listed Chat model. Audio and image generation use separate adapters. Review MCP permissions separately for workspace tools.</p>
    <div className="divide-y divide-line">
      {rows.map(row => <details key={row.id} className="min-w-0 py-2">
        <summary className="min-h-11 cursor-pointer break-words text-sm"><strong>{row.label}</strong> · {row.configuration} · {row.selection}</summary>
        <p className="mb-2 break-all text-sm text-muted">{row.model || "No exact Chat model selected"} · {row.discovery}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          {PROVIDER_MODALITIES.map(modality => <div key={modality} className="flex flex-wrap justify-between gap-x-2 rounded-panel border border-line px-3 py-2 text-sm">
            <dt>{modality === "Tools" ? "Provider-native tools" : modality}</dt><dd className="text-muted">{row.capabilities[modality]}</dd>
          </div>)}
        </dl>
        <p className="mt-2 text-sm text-muted">{row.evidence}</p>
      </details>)}
    </div>
  </section>;
}
