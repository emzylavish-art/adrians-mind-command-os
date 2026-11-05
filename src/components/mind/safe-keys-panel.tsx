import { SAFE_KEY_CAPABILITIES, SAFE_KEY_STATUS } from "@/lib/mind/safe-keys";

/** Capability-scoped, read-only inventory. Secret values and write controls never enter the browser. */
export function SafeKeysPanel() {
  return (
    <section className="settings-card rounded-panel p-4" aria-labelledby="safe-keys-title" data-testid="safe-keys-panel">
      <div className="mb-3">
        <h3 id="safe-keys-title" className="text-sm font-semibold">Safe Keys</h3>
        <p className="mt-1 text-xs text-muted">
          Keys are organized by capability, not provider. Secure authenticated storage and per-capability configuration status have not been verified; no secret values are displayed, accepted, copied, or revealed here.
        </p>
      </div>
      <ul className="divide-y divide-line/70">
        {SAFE_KEY_CAPABILITIES.map((capability) => (
          <li key={capability.id} className="flex min-h-14 items-center justify-between gap-4 py-2" data-testid={`safe-key-${capability.id}`}>
            <span className="min-w-0 text-sm font-medium">{capability.name}</span>
            <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted" aria-label={`${capability.name}: ${SAFE_KEY_STATUS}`}>
              {SAFE_KEY_STATUS}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">No input, reveal, copy, or save action is available. Do not treat this inventory as evidence that any key is configured.</p>
    </section>
  );
}
