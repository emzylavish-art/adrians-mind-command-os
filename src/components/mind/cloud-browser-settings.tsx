import { useEffect, useState } from "react";
import { BrowserEnvironments } from "@/components/mind/browser-environments";
import {
  browserAddress, browserPermissions, browserPreferencesKey, defaultBrowserPreferences,
  parseBrowserPreferences, authorizeBrowserAction, type BrowserPermission, type BrowserPreferences,
} from "@/lib/mind/browser-permissions";

const labels: Record<BrowserPermission, string> = { ask: "Always ask", allow: "Allow opening", block: "Block" };
const control = "min-h-11 max-w-full rounded-panel border border-line bg-surface px-3";

function PermissionSelect({ label, value, onChange }: { label: string; value: BrowserPermission; onChange: (value: BrowserPermission) => void }) {
  return <select aria-label={label} className={control} value={value} onChange={(event) => onChange(event.target.value as BrowserPermission)}>
    {browserPermissions.map((permission) => <option key={permission} value={permission}>{labels[permission]}</option>)}
  </select>;
}

export function CloudBrowserSettings({ owner }: { owner: string | null }) {
  const [settings, setSettings] = useState<BrowserPreferences | null>(null);
  const [site, setSite] = useState("");
  const [newPermission, setNewPermission] = useState<BrowserPermission>("ask");
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState("");
  const key = owner ? browserPreferencesKey(owner) : null;

  useEffect(() => {
    setSettings(null); setNotice(""); setAddress(""); setSite("");
    if (!key) return;
    function read() {
      try { setSettings(parseBrowserPreferences(localStorage.getItem(key!))); }
      catch { setSettings(null); setNotice("Browser preferences could not be read. Website opening is unavailable."); }
    }
    read();
    function sync(event: StorageEvent) { if (event.key === key || event.key === null) read(); }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  function update(fn: (prev: BrowserPreferences) => BrowserPreferences) {
    if (!key) return false;
    try {
      const next = fn(parseBrowserPreferences(localStorage.getItem(key)));
      localStorage.setItem(key, JSON.stringify(next));
      setSettings(next);
      setNotice("Preference saved for this account on this device.");
      return true;
    } catch {
      setNotice("Could not save this preference. Check browser storage and try again.");
      return false;
    }
  }

  function handoff() {
    const target = browserAddress(address);
    if (!key || !target) { setNotice("Enter an HTTP or HTTPS website address."); return; }
    let authorization;
    try { authorization = authorizeBrowserAction(parseBrowserPreferences(localStorage.getItem(key)), target, "open"); }
    catch { setNotice("Could not verify browser permissions."); return; }
    if (!authorization.allowed) { setNotice(authorization.reason); return; }
    if (authorization.needsConfirmation && !window.confirm(`Open ${target.href} in your browser?`)) { setNotice("Website handoff cancelled. No agent action was dispatched."); return; }
    window.open(target.href, "_blank", "noopener,noreferrer");
    setNotice(`Requested a personal-browser tab for ${target.origin}. Check your browser if it blocked the popup. Adrian cannot inspect or control that tab.`);
  }

  return <section className="settings-card space-y-5 rounded-panel p-4 text-sm" aria-labelledby="cloud-browser-title">
    <h3 id="cloud-browser-title" className="font-display text-xl font-bold">Cloud browser</h3>
    <p className="text-muted">Mind OS can hand a website over to your browser. You control that tab. Autonomous cloud browsing is unavailable.</p>
    <BrowserEnvironments />
    {!key ? <p>Sign in to manage your website permissions.</p> : settings && <>
      <div className="settings-row flex-wrap"><div><p className="font-semibold">Default permissions</p><p className="text-muted">Applies to website handoffs from this panel.</p></div>
        <PermissionSelect label="Default permissions" value={settings.defaultPermission} onChange={(defaultPermission) => update((prev) => ({ ...prev, defaultPermission }))} /></div>
      <div><p className="font-semibold">Email verification codes</p><p className="text-muted">Enter your code on the website yourself.</p></div>
      <div><p className="font-semibold">CAPTCHAs</p><p className="text-muted">Complete the challenge yourself in the website tab.</p></div>
      <fieldset className="space-y-2"><legend className="font-semibold">Specific websites</legend>
        {Object.entries(settings.sites).map(([origin, permission]) => <div key={origin} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-all">{origin}</span>
          <PermissionSelect label={`Permission for ${origin}`} value={permission} onChange={(value) => update((prev) => ({ ...prev, sites: { ...prev.sites, [origin]: value } }))} />
          <button type="button" className={control} aria-label={`Remove rule for ${origin}`} onClick={() => update((prev) => {
            const sites = { ...prev.sites }; delete sites[origin]; return { ...prev, sites };
          })}>Remove</button>
        </div>)}
        <form className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault(); const url = browserAddress(site);
          if (!url) { setNotice("Enter an HTTP or HTTPS website address."); return; }
          if (update((prev) => ({ ...prev, sites: { ...prev.sites, [url.origin]: newPermission } }))) setSite("");
        }}>
          <input aria-label="Website for permission" className={control} placeholder="example.com" value={site} onChange={(event) => setSite(event.target.value)} />
          <PermissionSelect label="Permission for new website" value={newPermission} onChange={setNewPermission} />
          <button type="submit" className={control}>Save website rule</button>
        </form>
      </fieldset>
      <div><p className="font-semibold">Browser data</p><p className="text-muted">Website cookies stay in the browser you open. Manage or clear them in that browser’s settings.</p></div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); handoff(); }}>
        <input aria-label="Website to open" className={control} placeholder="https://example.com" value={address} onChange={(event) => setAddress(event.target.value)} />
        <button className={control} type="submit">Open website</button>
      </form>
    </>}
    {key && !settings && notice && <button className={control} type="button" onClick={() => {
      if (!window.confirm("Reset browser permissions for this account on this device?")) return;
      try { localStorage.removeItem(key); setSettings(defaultBrowserPreferences); setNotice("Website permissions reset to Always ask."); }
      catch { setNotice("Browser storage is unavailable."); }
    }}>Reset browser permissions</button>}
    <p role="status" className="text-muted">{notice}</p>
  </section>;
}
