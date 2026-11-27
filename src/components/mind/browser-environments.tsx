import { browserEnvironments } from "@/lib/mind/browser-permissions";

export function BrowserEnvironments() {
  return <details className="rounded-panel border border-line p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Browser environments and permissions</summary>
    <dl className="mt-3 space-y-3">
      {browserEnvironments.map(item => <div key={item.id}>
        <dt className="font-medium">{item.label} · {item.availability}</dt>
        <dd className="text-muted">{item.location}. {item.scope}</dd>
      </div>)}
    </dl>
  </details>;
}
