import { useEffect, useState } from "react";
import { SAFE_KEY_CAPABILITIES, SAFE_KEY_STATUS } from "@/lib/mind/safe-keys";
import { copyOwnerKeyFn, listOwnerKeySlotsFn } from "@/lib/mind/owner-keys-fns";

export type SafeKeySlot = {
  id: string;
  label: string;
  use: string;
  present: boolean;
  last4: string;
};

type SafeKeysPanelProps = {
  slots?: SafeKeySlot[];
  onCopy?: (id: string) => Promise<string | null>;
};

async function copyThroughServer(id: string): Promise<{ value: string | null; error: string | null }> {
  try {
    const result = await copyOwnerKeyFn({ data: { id } });
    return result.ok ? { value: result.value, error: null } : { value: null, error: result.error };
  } catch {
    return { value: null, error: "The key could not be copied. Check this browser's clipboard permission." };
  }
}

/** Capability inventory plus local owner-key copy. Full secret values are never rendered. */
export function SafeKeysPanel({ slots, onCopy }: SafeKeysPanelProps = {}) {
  const [loaded, setLoaded] = useState<SafeKeySlot[]>(slots ?? []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    if (slots) {
      setLoaded(slots);
      return;
    }
    let active = true;
    void listOwnerKeySlotsFn()
      .then((result) => {
        if (active) setLoaded(result.slots);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [slots]);

  async function copySlot(id: string) {
    setCopiedId(null);
    setCopyError(null);
    const response = onCopy ? { value: await onCopy(id), error: null } : await copyThroughServer(id);
    const secret = response.value;
    if (!secret) {
      setCopyError(response.error || "The key is not available to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedId(id);
    } catch {
      setCopyError("The browser blocked clipboard access. Allow clipboard permission and try again.");
    }
  }

  return (
    <section className="settings-card rounded-panel p-4" aria-labelledby="safe-keys-title" data-testid="safe-keys-panel">
      <div className="mb-3">
        <h3 id="safe-keys-title" className="text-sm font-semibold">Safe Keys</h3>
        <p className="mt-1 text-xs text-muted">
          Keys are organized by capability, not provider. Secure authenticated storage and per-capability configuration status have not been verified. Secret values are not shown and cannot be pasted here.
        </p>
      </div>
      <div className="mb-4" data-testid="owner-key-slots">
        <h4 className="text-sm font-semibold">Owner keys</h4>
        <ul className="mt-2 divide-y divide-line/70">
          {loaded.map((slot) => (
            <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid={`owner-key-${slot.id}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{slot.label}</p>
                <p className="text-xs text-muted">{slot.use}</p>
                <p className="text-xs text-muted">
                  {slot.present ? "present" : "missing"}
                  {slot.present && slot.last4 ? ` · ${slot.last4}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => void copySlot(slot.id)}
                >
                  Copy
                </button>
                {copiedId === slot.id ? <span className="text-xs text-muted">Copied</span> : null}
              </div>
            </li>
          ))}
        </ul>
        {copyError ? <p className="mt-2 text-xs text-muted" role="status">{copyError}</p> : null}
      </div>
      <ul className="divide-y divide-line/70">
        {loaded.length > 0 ? null : SAFE_KEY_CAPABILITIES.map((capability) => (
          <li key={capability.id} className="flex min-h-14 items-center justify-between gap-4 py-2" data-testid={`safe-key-${capability.id}`}>
            <span className="min-w-0 text-sm font-medium">{capability.name}</span>
            <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted" aria-label={`${capability.name}: ${SAFE_KEY_STATUS}`}>
              {SAFE_KEY_STATUS}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Direct and modules use the module key. Speak uses the voice key. The management key only creates keys. Copy puts the value on the clipboard and does not show it here.</p>
    </section>
  );
}
