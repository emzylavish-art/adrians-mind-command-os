import { useEffect, useRef, useState } from "react";
import { SAFE_KEY_CAPABILITIES, safeKeyStatus } from "@/lib/mind/safe-keys";
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
  openAiConfigured?: boolean;
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
export function SafeKeysPanel({ slots, onCopy, openAiConfigured = false }: SafeKeysPanelProps = {}) {
  const [loaded, setLoaded] = useState<SafeKeySlot[]>(slots ?? []);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<{ id: string; message: string } | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copyFlight = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(slots ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const canCopyHere = Boolean(onCopy) || (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname));

  useEffect(() => {
    if (slots) {
      setLoaded(slots);
      setStatus("ready");
      return;
    }
    let active = true;
    setStatus("loading");
    void listOwnerKeySlotsFn()
      .then((result) => {
        if (active) { setLoaded(result.slots); setStatus("ready"); }
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => {
      active = false;
    };
  }, [slots, attempt]);

  async function copySlot(id: string) {
    if (copyFlight.current) return;
    copyFlight.current = true;
    setCopyingId(id);
    setCopiedId(null);
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        setCopyError({ id, message: "Clipboard access is unavailable in this browser." });
        return;
      }
      const response = onCopy ? { value: await onCopy(id), error: null } : await copyThroughServer(id);
      if (!response.value) {
        setCopyError({ id, message: response.error || "The key is not available to copy." });
        return;
      }
      await navigator.clipboard.writeText(response.value);
      setCopiedId(id);
    } catch {
      setCopyError({ id, message: "Couldn’t copy the key. Check clipboard permission and try again." });
    } finally {
      copyFlight.current = false;
      setCopyingId(null);
    }
  }

  return (
    <section className="settings-card rounded-panel p-4" aria-labelledby="safe-keys-title" data-testid="safe-keys-panel">
      <div className="mb-3">
        <h3 id="safe-keys-title" className="text-sm font-semibold">Safe Keys</h3>
        <p className="mt-1 text-xs text-muted">
          Check which owner keys are configured. Use Connections to set up a provider.
        </p>
      </div>
      <div className="mb-4" data-testid="owner-key-slots">
        <h4 className="text-sm font-semibold">Owner keys</h4>
        {status === "loading" && <p role="status" className="mt-2 text-sm text-muted">Checking saved keys…</p>}
        {status === "error" && <p role="status" className="mt-2 text-sm text-muted">Couldn’t check saved keys. <button type="button" className="min-h-11 text-accent" onClick={() => setAttempt((value) => value + 1)}>Retry</button></p>}
        <ul className="mt-2 divide-y divide-line/70">
          {loaded.map((slot) => (
            <li key={slot.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid={`owner-key-${slot.id}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{slot.label}</p>
                <p className="text-xs text-muted">{slot.use}</p>
                <p className="text-xs text-muted">
                  {slot.present ? "Configured" : "Missing"}
                  {slot.present && slot.last4 ? ` · ${slot.last4}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {slot.present && canCopyHere && <button
                  type="button"
                  aria-label={`Copy ${slot.label}`}
                  disabled={copyingId !== null}
                  className="min-h-11 rounded-panel border border-line px-3 text-sm"
                  onClick={() => void copySlot(slot.id)}
                >
                  {copyingId === slot.id ? "Copying…" : "Copy"}
                </button>}
                {slot.present && !canCopyHere && <span className="text-xs text-muted">Copy on the local device</span>}
                {copiedId === slot.id ? <span role="status" className="text-xs text-muted">Copied</span> : null}
              </div>
              {copyError?.id === slot.id && <p role="status" className="basis-full text-xs text-danger">{copyError.message}</p>}
            </li>
          ))}
        </ul>
      </div>
      <ul className="divide-y divide-line/70">
        {status !== "ready" || loaded.length > 0 ? null : SAFE_KEY_CAPABILITIES.map((capability) => (
          <li key={capability.id} className="flex min-h-14 items-center justify-between gap-4 py-2" data-testid={`safe-key-${capability.id}`}>
            <span className="min-w-0 text-sm font-medium">{capability.name}</span>
            <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted" aria-label={`${capability.name}: ${safeKeyStatus(capability.id, { openai: openAiConfigured })}`}>
              {safeKeyStatus(capability.id, { openai: openAiConfigured })}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Direct and modules use the module key. Speak uses the voice key. The management key only creates keys. Copy puts the value on the clipboard and does not show it here.</p>
    </section>
  );
}
