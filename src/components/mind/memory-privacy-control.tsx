import { useEffect, useRef, useState } from "react";
import type { OwnerMemoryPolicy } from "@/lib/mind/memory/policy.server";

export function MemoryPrivacyControl({ ownerId, request = fetch, onPolicy }: { ownerId: string; request?: typeof fetch; onPolicy?: (policy: OwnerMemoryPolicy | null) => void }) {
  const [policy, setPolicy] = useState<OwnerMemoryPolicy | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const current = useRef({ ownerId, request, onPolicy }); current.current = { ownerId, request, onPolicy };
  const generation = useRef(0);
  const read = async () => {
    const owner = current.current.ownerId;
    const run = ++generation.current;
    setPending(true); setError("");
    try {
      const response = await current.current.request("/api/mind/memory-policy", { credentials: "include", cache: "no-store" });
      const result = await response.json();
      if (run !== generation.current || owner !== current.current.ownerId) return;
      if (!response.ok || !result.ok || typeof result.policy?.suspended !== "boolean") throw new Error(result.error || "Memory privacy could not be loaded.");
      setPolicy(result.policy); current.current.onPolicy?.(result.policy);
    } catch (cause) {
      if (run !== generation.current || owner !== current.current.ownerId) return;
      setPolicy(null); current.current.onPolicy?.(null); setError(cause instanceof Error ? cause.message : "Memory privacy is unavailable.");
    } finally { if (run === generation.current && owner === current.current.ownerId) setPending(false); }
  };
  useEffect(() => {
    setPolicy(null); current.current.onPolicy?.(null); void read();
    const onFocus = () => { void read(); };
    window.addEventListener("focus", onFocus);
    return () => { generation.current++; window.removeEventListener("focus", onFocus); };
    // Account identity owns the request. Replacing callback identities must not restart it.
  }, [ownerId]);
  const change = async (suspended: boolean) => {
    if (!policy || pending) return;
    const owner = current.current.ownerId;
    const run = ++generation.current;
    setPending(true); setError("");
    try {
      const response = await current.current.request("/api/mind/memory-policy", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ suspended, expectedRevision: policy.revision }) });
      const result = await response.json();
      if (run !== generation.current || owner !== current.current.ownerId) return;
      if (!response.ok || !result.ok) throw new Error(result.error || "The memory setting was not saved.");
      setPolicy(result.policy); current.current.onPolicy?.(result.policy);
    } catch (cause) { if (run === generation.current && owner === current.current.ownerId) { setError(cause instanceof Error ? cause.message : "The memory setting was not saved."); current.current.onPolicy?.(null); } }
    finally { if (run === generation.current && owner === current.current.ownerId) setPending(false); }
  };
  return <section className="rounded-xl border border-white/10 bg-white/[.025] p-4 space-y-2" aria-labelledby="memory-privacy-title">
    <h3 id="memory-privacy-title" className="text-sm font-medium">Account memory privacy</h3>
    <label className="flex gap-3 items-center text-sm"><input type="checkbox" checked={policy?.suspended ?? false} disabled={!policy || pending} onChange={(event) => void change(event.target.checked)} />Suspend saved context across all chats</label>
    <p className="text-xs text-muted-foreground">Pauses saved memory, bot knowledge and project context for this account. Existing notes and chat preferences stay saved. New sends and retries check this setting on the server. A request already sent cannot be recalled.</p>
    <p className="text-xs" role="status">{pending ? "Checking the account setting…" : policy ? policy.suspended ? "Suspended on the server." : "Saved context follows each chat's settings." : "Current server setting is unknown."}</p>
    {error && <p className="text-xs text-amber-300" role="alert">{error}</p>}
    <button type="button" className="text-xs underline" disabled={pending} onClick={() => void read()}>Refresh account setting</button>
  </section>;
}
