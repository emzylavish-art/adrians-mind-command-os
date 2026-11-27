import { useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
type Device = { id: string; current: boolean; device: string; lastActiveAt: string; expiresAt: string };
export function SessionCenter() {
  const [devices, setDevices] = useState<Device[] | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load(revokeId?: string) {
    if (busy) return; if (revokeId && !window.confirm("Revoke this other session? It will need to sign in again. Saved workspace data is kept.")) return;
    setBusy(true); setError("");
    try { const token = getBearerToken(); const response = await fetch("/api/mind/sessions", { credentials: "same-origin", method: revokeId ? "POST" : "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(revokeId ? { "content-type": "application/json" } : {}) }, body: revokeId ? JSON.stringify({ action: "revoke", id: revokeId }) : undefined }); const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error || "Session details are unavailable."); if (revokeId) setDevices((rows) => rows?.filter((row) => row.id !== revokeId) ?? null); else setDevices(body.sessions); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Session details are unavailable."); } finally { setBusy(false); }
  }
  return <section className="settings-card space-y-3 rounded-panel p-4 text-sm"><h3 className="font-semibold">Sessions and recovery</h3><p className="text-muted">Expired sign-in does not erase your account’s saved drafts. After signing in again, recover an unfinished request using its original send ID before starting a new request.</p><button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3" onClick={() => void load()}>{busy ? "Checking…" : "Refresh verified sessions"}</button>{error && <p role="alert">{error}</p>}{devices?.map((device) => <article key={device.id} className="rounded-panel border border-line p-3"><p>{device.current ? "Current session" : "Other session"} · {device.device}</p><p className="text-xs text-muted">Last active {device.lastActiveAt} · Expires {device.expiresAt}</p>{!device.current && <button type="button" disabled={busy} className="min-h-11 text-warning" onClick={() => void load(device.id)}>Revoke this session</button>}</article>)}</section>;
}
