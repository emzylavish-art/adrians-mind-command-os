import { useEffect, useId, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { useAccountPreferences } from "@/components/mind/account-preferences-context";
import { PLUGIN_SELECTION_KEY, pluginReadiness, readPluginSelections, type PluginSelection, type PluginConnectionEvidence } from "@/lib/mind/plugin-catalog";

const CURATED = [
  { id: "superpowers", name: "Superpowers", mark: "Sp", image: "", color: "#d97757", description: "Planning, debugging, and delivery instructions.", kind: "instructions" as const, href: "https://github.com/obra/superpowers" },
  { id: "vercel-plugin", name: "Vercel", mark: "Vc", image: "/brand/logos/vercel.svg", color: "#111111", description: "Development and deployment guidance; no deployment adapter is installed here.", kind: "instructions" as const, href: "https://github.com/vercel/vercel-plugin" },
  { id: "modern-web-guidance", name: "Web guidance", mark: "Wb", image: "", color: "#1a73e8", description: "Web platform and browser instructions.", kind: "instructions" as const, href: "https://github.com/GoogleChrome/modern-web-guidance" },
  { id: "cloudbase", name: "CloudBase", mark: "Cb", image: "", color: "#00a4ff", description: "MCP integration requiring a separately configured connection.", kind: "mcp" as const, href: "https://github.com/TencentCloudBase/CloudBase-AI-Toolkit" },
] as const;
const PLUGIN_TABS = ["added", "official", "curated", "custom"] as const;
type SavedConnection = PluginConnectionEvidence & { label: string; host: string };

export function KimiDeviceConnect() {
  const storage = useAccountPreferences();
  const tabId = useId();
  const [notice, setNotice] = useState("Catalogue bookmarks, instruction sets, and executable connections have separate readiness states.");
  const [mcpUrl, setMcpUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<PluginSelection[]>([]);
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [binding, setBinding] = useState("");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const curatedTab = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<(typeof PLUGIN_TABS)[number]>("curated");

  async function authed(path: string, action?: Record<string, unknown>) {
    const token = getBearerToken();
    const response = await fetch(path, { method: action ? "POST" : "GET", credentials: "include", cache: "no-store", headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(action ? { "content-type": "application/json" } : {}) }, ...(action ? { body: JSON.stringify(action) } : {}) });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(typeof body?.error === "string" ? body.error : "The connection request could not complete.");
    return body;
  }
  async function refreshConnections() {
    const body = await authed("/api/mind/mcp/servers?view=saved");
    setConnections(Array.isArray(body.servers) ? body.servers : []);
    setLoadedAt(new Date().toISOString());
  }
  useEffect(() => {
    try { setAdded(readPluginSelections(storage.getItem(PLUGIN_SELECTION_KEY))); }
    catch { setNotice("Account plugin preferences could not be read. No integration was enabled."); }
    let active = true;
    void authed("/api/mind/mcp/servers?view=saved").then(body => { if (active) { setConnections(Array.isArray(body.servers) ? body.servers : []); setLoadedAt(new Date().toISOString()); } }).catch(() => { if (active) setConnections([]); });
    return () => { active = false; };
  }, [storage]);

  function remember(next: PluginSelection[]) {
    storage.setItem(PLUGIN_SELECTION_KEY, JSON.stringify(next));
    setAdded(next);
  }
  function addPlugin(plugin: (typeof CURATED)[number]) {
    try {
      if (!added.some(item => item.id === plugin.id)) remember([...added, { id: plugin.id, enabled: true }]);
      if (plugin.kind === "mcp") { setBinding(plugin.id); setTab("custom"); setNotice(`${plugin.name} added to this account's catalogue. Select or configure its connection; nothing is operational yet.`); }
      else { setTab("added"); setNotice(`${plugin.name} bookmarked. Open its source to review instructions, then use Skills for explicit activation. External software was not installed.`); }
    } catch { setNotice("The catalogue change could not be saved. Existing selections were preserved."); }
  }
  async function manage(selection: PluginSelection, action: "disable" | "enable" | "remove") {
    if (busy) return;
    setBusy(true);
    try {
      if (selection.connectionId) {
        // Disable/remove in the catalogue also disables the bound account registry
        // entry. Existing dispatch gates re-read that entry before any call.
        await authed("/api/mind/mcp/servers", { action: "toggle", id: selection.connectionId, enabled: action === "enable" });
      }
      remember(action === "remove" ? added.filter(item => item.id !== selection.id) : added.map(item => item.id === selection.id ? { ...item, enabled: action === "enable" } : item));
      await refreshConnections().catch(() => setConnections([]));
      setNotice(action === "remove" ? "Catalogue entry removed. Its bound Adrian connection was disabled when present. External software and provider authorization were not uninstalled or revoked." : action === "disable" ? "Disabled for future Adrian actions. The connection configuration remains saved." : "Enabled for consideration. Readiness still depends on current connection capabilities.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Plugin management did not complete."); }
    finally { setBusy(false); }
  }
  async function saveMcp() {
    if (!mcpUrl.trim() || busy) return;
    setBusy(true);
    try {
      const plugin = CURATED.find(item => item.id === binding);
      const body = await authed("/api/mind/build/providers", { action: "mcp_save", label: plugin?.name || "Custom MCP", url: mcpUrl });
      const connection = body.connection;
      if (binding && typeof connection?.id === "string") remember(added.map(item => item.id === binding ? { ...item, connectionId: connection.id, enabled: true } : item));
      await refreshConnections();
      setNotice(`MCP configuration saved: ${connection?.state || "unchecked"}. ${connection?.error || "Tool metadata is not proof of successful execution."}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "MCP configuration was not saved."); }
    finally { setBusy(false); }
  }
  function bindExisting(id: string) {
    if (!binding || !connections.some(connection => connection.id === id)) return;
    try { remember(added.map(item => item.id === binding ? { ...item, connectionId: id, enabled: true } : item)); setNotice("Selected the exact account connection. No tool was called and no provider permission was changed."); }
    catch { setNotice("Could not save the selected connection."); }
  }

  return <section className="plugin-catalog rounded-panel border border-line p-3" aria-label="Plugins">
    <h3 className="font-semibold">Plugins</h3>
    <p className="mt-1 text-sm text-muted" role="status">{notice}</p>
    <div className="workspace-tabs mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Plugin groups" onKeyDown={event => {
      const index = PLUGIN_TABS.indexOf(tab), last = PLUGIN_TABS.length - 1;
      const next = event.key === "ArrowRight" ? (index + 1) % PLUGIN_TABS.length : event.key === "ArrowLeft" ? (index + last) % PLUGIN_TABS.length : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
      if (next < 0) return; event.preventDefault(); setTab(PLUGIN_TABS[next]); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{PLUGIN_TABS.map(item => <button key={item} id={`${tabId}-${item}`} ref={item === "curated" ? curatedTab : undefined} type="button" role="tab" aria-selected={tab === item} aria-controls={`${tabId}-panel`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} className="min-h-11 rounded-panel border px-3 text-sm capitalize">{item}</button>)}</div>
    <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
      <div className="mt-3 grid gap-2" role="group" aria-label="Adrian plugins">
        {(tab === "added" ? CURATED.filter(plugin => added.some(item => item.id === plugin.id)) : tab === "curated" ? CURATED : []).map(plugin => {
          const selection = added.find(item => item.id === plugin.id);
          const connection = connections.find(item => item.id === selection?.connectionId);
          const readiness = pluginReadiness(plugin.kind, selection, connection);
          return <article key={plugin.id} className="plugin-link">
            <div className="plugin-link__main">
              {plugin.image.endsWith(".svg") ? <img className="service-mark" src={plugin.image} alt="" width={28} height={28} /> : <span className="service-mark" style={{ background: plugin.color, color: "#fff" }} aria-hidden="true">{plugin.mark}</span>}
              <div className="min-w-0"><a className="inline-flex min-h-11 items-center font-semibold underline" href={plugin.href} target="_blank" rel="noreferrer">{plugin.name}</a><p className="text-sm text-muted">{plugin.description}</p><p className="mt-1 text-xs">{readiness.state.replaceAll("_", " ")} · {readiness.detail}</p>
                {connection && <p className="mt-1 text-xs text-muted">Account connection: {connection.label} · {connection.host} · {connection.id}. Metadata loaded {loadedAt ? new Date(loadedAt).toLocaleString() : "not loaded"}.</p>}
                {readiness.capabilities.length > 0 && <details className="mt-2 text-xs"><summary>Capabilities and permissions</summary><ul>{readiness.capabilities.map(capability => <li key={capability.name}>{capability.name}: {capability.permission === "unknown" ? "permissions unclassified; explicit action review required" : capability.permission === "instructions" ? "instruction reference; no tool permission" : `${capability.permission} access; existing action review remains required`}</li>)}</ul></details>}
              </div>
            </div>
            <div className="plugin-link__action flex flex-wrap gap-2">{selection ? <>
              {plugin.kind === "mcp" && <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => { setBinding(plugin.id); setTab("custom"); }}>Configure</button>}
              <button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void manage(selection, selection.enabled ? "disable" : "enable")}>{selection.enabled ? "Disable" : "Enable"}</button>
              <button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void manage(selection, "remove")}>Remove from catalogue</button>
            </> : <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" onClick={() => addPlugin(plugin)}>{plugin.kind === "instructions" ? "Bookmark" : "Add and configure"}</button>}</div>
          </article>;
        })}
        {(tab === "official" || (tab === "added" && added.length === 0)) && <div className="plugin-empty"><p className="text-sm text-muted">{tab === "official" ? "No official operational plugins are listed here." : "No account catalogue entries added yet."}</p><button type="button" className="mt-2 min-h-11 rounded-panel border border-line px-3" onClick={() => { setTab("curated"); curatedTab.current?.focus(); }}>Browse curated plugins</button></div>}
      </div>
      {tab === "custom" && <div className="mt-3 space-y-3">
        <p className="text-sm text-muted">Selected catalogue entry: {CURATED.find(item => item.id === binding)?.name || "independent custom connection"}. Each external tool action requires its existing confirmation. Changing the catalogue never installs external software.</p>
        {binding && <label className="grid gap-1 text-sm">Use an existing account connection<select className="min-h-11 rounded-panel border border-line bg-bg px-3" value={added.find(item => item.id === binding)?.connectionId || ""} onChange={event => bindExisting(event.target.value)}><option value="">Choose the exact connection</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.label} · {connection.host} · {connection.state}</option>)}</select></label>}
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void saveMcp(); }}><input id="kimi-mcp-url" aria-label="Custom plugin server URL" value={mcpUrl} onChange={event => setMcpUrl(event.target.value)} placeholder="https://your-mcp.example/mcp" className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-bg px-3 text-sm" /><button type="submit" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy}>Connect MCP</button></form>
        <button type="button" disabled={busy} className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => void refreshConnections().then(() => setNotice("Saved connection metadata refreshed. No external tool was executed.")).catch(error => setNotice(error.message))}>Refresh saved connections</button>
      </div>}
    </div>
  </section>;
}
