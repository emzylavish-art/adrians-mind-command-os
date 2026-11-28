import { useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { PasskeySettings } from "./passkey-settings";

type Device = { id: string; current: boolean; device: string; lastActiveAt: string; expiresAt: string };

export function SessionCenter() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState(false);

  async function load(revokeId?: string, lockdownId?: string) {
    if (busy) return;
    if (revokeId && !window.confirm("Revoke this other session? It will need to sign in again. Saved workspace data is kept.")) return;
    if (lockdownId && !window.confirm("Revoke every other Better Auth session? Keep this session open to verify the result.")) return;
    setBusy(true);
    setError("");
    setNotice("");
    let revokeConfirmed = false;
    try {
      const token = getBearerToken();
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      if (lockdownId) {
        const response = await fetch("/api/mind/sessions", {
          credentials: "same-origin", method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ action: "lockdown", currentId: lockdownId }),
        });
        const body = await response.json();
        if (!response.ok || !body.ok || !Array.isArray(body.sessions)) throw new Error(body.error || "Session lockdown could not be confirmed.");
        setDevices(body.sessions);
        setNotice(body.remainingOther === 0 ? "Session lockdown verified. This is the only active Better Auth session." :
          "The provider acknowledged revocation. Refresh to review the other sessions still listed.");
        return;
      }
      if (revokeId) {
        const response = await fetch("/api/mind/sessions", {
          credentials: "same-origin", method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ action: "revoke", id: revokeId }),
        });
        const body = await response.json();
        if (!response.ok || !body.ok || body.revokedId !== revokeId) throw new Error(body.error || "Revocation could not be confirmed.");
        revokeConfirmed = true;
      }
      const response = await fetch("/api/mind/sessions", { credentials: "same-origin", headers, cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok || !Array.isArray(body.sessions)) throw new Error(body.error || "Session details are unavailable.");
      setDevices(body.sessions);
      setPasskeys(body.passkeys === true);
      if (revokeId) {
        setNotice(body.sessions.some((row: Device) => row.id === revokeId)
          ? "The provider acknowledged revocation. This session still appears in its list."
          : "Revocation confirmed. The refreshed list no longer includes that session.");
      }
    } catch (caught) {
      setDevices(null);
      if (revokeConfirmed) setNotice("The provider acknowledged revocation. Refresh to verify the current list.");
      else if (revokeId) setNotice("Refresh the list before retrying revocation.");
      else if (lockdownId) setNotice("Refresh the list before retrying session lockdown.");
      setError(caught instanceof Error ? caught.message : "Session details are unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="settings-card space-y-3 rounded-panel p-4 text-sm">
    <h3 className="font-semibold">Sessions and recovery</h3>
    <p className="text-muted">After signing in again, use the original send ID to check an unfinished request.</p>
    <button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void load()}>{busy ? "Checking…" : "Refresh verified sessions"}</button>
    {devices?.some(device => device.current) && <div className="space-y-1">
      <p className="text-muted">Session lockdown signs other Better Auth devices out. Future sign-ins still follow your sign-in provider’s rules.</p>
      {devices.filter(device => device.current).map(device => <button key={device.id} type="button" disabled={busy}
        className="min-h-11 rounded-panel border border-line px-3 text-warning" onClick={() => void load(undefined, device.id)}>
        Revoke all other sessions
      </button>)}
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {devices?.length === 0 && <p>The provider returned an empty session list.</p>}
    {devices?.map(device => <article key={device.id} className="break-words rounded-panel border border-line p-3">
      <p>{device.current ? "Current session" : "Other session"} · {device.device}</p>
      <p className="text-xs text-muted">Last active {device.lastActiveAt} · Expires {device.expiresAt}</p>
      {!device.current && <button type="button" disabled={busy} className="min-h-11 text-warning" onClick={() => void load(device.id)}>Revoke this session</button>}
    </article>)}
    {passkeys && <PasskeySettings />}
  </section>;
}
