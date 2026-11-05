import { SAFE_KEY_PROVIDERS } from "@/lib/mind/safe-keys";

/** Read-only inventory; secret values and write controls never enter the browser. */
export function SafeKeysPanel() {
  return (
    <section className="settings-card rounded-panel p-4" aria-labelledby="safe-keys-title" data-testid="safe-keys-panel">
      <div className="mb-3">
        <h3 id="safe-keys-title" className="text-sm font-semibold">Safe Keys</h3>
        <p className="mt-1 text-xs text-muted">
          These credentials are managed on the server. This page never displays, accepts, or stores secret values; a blank row does not indicate whether a server key is configured.
        </p>
      </div>
      <ul className="divide-y divide-line/70">
        {SAFE_KEY_PROVIDERS.map((provider) => (
          <li key={provider.id} className="flex min-h-14 items-center justify-between gap-4 py-2" data-testid={`safe-key-${provider.id}`}>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{provider.name}</span>
              <span className="block truncate text-xs text-muted">{provider.environment}</span>
            </span>
            <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted" aria-label={`${provider.name}: secret value not shown`}>
              — <span className="sr-only">Not shown in browser</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">No edit or save action is available here. Configure server credentials only through the approved secret-management channel.</p>
    </section>
  );
}
