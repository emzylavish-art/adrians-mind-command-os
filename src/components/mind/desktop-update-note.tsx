import { useRef, useEffect, useState } from "react";
type UpdateBody = { note?: unknown; decision?: { action?: unknown; url?: unknown }; feeds?: Array<{ source?: string; code?: string; detail?: string }>; candidates?: Array<{ source?: string; code?: string; detail?: string }> };
export function DesktopUpdateNote() {
  const [text, setText] = useState("Check signed Windows release metadata. Installed version is reported by the desktop app.");
  const [busy, setBusy] = useState(false);
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  async function check() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    setBusy(true); setReleaseUrl(null); setDiagnostics([]); setText("Checking release authenticity and compatibility…");
    try {
      const response = await fetch("/api/mind/desktop-update?check=cloud", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Update check returned HTTP ${response.status}. Availability is unknown.`);
      const body = await response.json() as UpdateBody;
      if (request.current !== controller || controller.signal.aborted) return;
      setText(typeof body.note === "string" ? body.note : "Update availability is unknown.");
      setDiagnostics([...(body.feeds ?? []), ...(body.candidates ?? [])].map(item => `${item.source || "Feed"}: ${item.code || "received"}. ${item.detail || ""}`));
      const url = typeof body.decision?.url === "string" ? body.decision.url : "";
      setReleaseUrl(body.decision?.action === "install" && /^https:\/\/github\.com\/emzylavish-art\/adrians-mind-command-os\/releases\/tag\/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(url) ? url : null);
    } catch (error) { if (request.current === controller) setText(controller.signal.aborted ? "Update check timed out or was canceled. Release availability is unknown." : error instanceof Error ? error.message : "Update check failed. Release availability is unknown."); }
    finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  return <div className="px-3 pb-2" data-testid="desktop-update-note">
    <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" onClick={() => void check()} disabled={busy}>{busy ? "Checking…" : "Check Windows release"}</button>
    <p role="status" className="mt-2 text-xs text-muted">{text}</p>
    {releaseUrl && <a className="mt-2 inline-flex min-h-11 items-center text-sm underline" href={releaseUrl} target="_blank" rel="noopener noreferrer">Review release files (separate download)</a>}
    {diagnostics.length > 0 && <details className="mt-2 text-xs text-muted"><summary>Update check details</summary>{diagnostics.map((line, index) => <p key={index}>{line}</p>)}</details>}
  </div>;
}
