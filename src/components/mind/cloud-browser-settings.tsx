import { useEffect, useState } from "react";
import { browserAddress, browserPermissions, browserPreferencesKey, parseBrowserPreferences, websitePermission, type BrowserPermission, type BrowserPreferences } from "@/lib/mind/browser-permissions";

const labels: Record<BrowserPermission, string> = { ask: "Always ask", allow: "Allow opening", block: "Block" };
const control = "min-h-11 max-w-full rounded-panel border border-line bg-surface px-3";

export function CloudBrowserSettings({ owner }: { owner: string | null }) {
  const [settings, setSettings] = useState<BrowserPreferences | null>(null);
  const [site, setSite] = useState(""); const [permission, setPermission] = useState<BrowserPermission>("ask");
  const [address, setAddress] = useState(""); const [notice, setNotice] = useState("");
  const key = owner ? browserPreferencesKey(owner) : null;
  useEffect(() => {
    if (!key) return;
    const read = () => { try { setSettings(parseBrowserPreferences(localStorage.getItem(key))); } catch { setSettings(null); setNotice("Browser preferences could not be read."); } };
    read(); window.addEventListener("storage", read); return () => window.removeEventListener("storage", read);
  }, [key]);
  const update = (fn: (prev: BrowserPreferences) => BrowserPreferences) => {
    if (!key) return; try { const next = fn(parseBrowserPreferences(localStorage.getItem(key))); localStorage.setItem(key, JSON.stringify(next)); setSettings(next); setNotice("Preference saved for this account on this device."); } catch { setNotice("Could not save this preference."); }
  };
  if (!key) return <section className="settings-card rounded-panel p-4 text-sm"><h3 className="font-display text-xl font-bold">Cloud browser</h3><p className="mt-2 text-muted">Sign in to manage website handoff permissions.</p></section>;
  return <section className="settings-card space-y-4 rounded-panel p-4 text-sm" aria-labelledby="cloud-browser-title">
    <h3 id="cloud-browser-title" className="font-display text-xl font-bold">Cloud browser</h3>
    <p className="text-muted">Mind OS hands a website to your browser. You control that tab; verification codes and CAPTCHA challenges stay with you.</p>
    {settings && <><label className="grid gap-1"><span className="font-semibold">Default permissions</span><select aria-label="Default website permission" className={control} value={settings.defaultPermission} onChange={(e) => update((prev) => ({ ...prev, defaultPermission: e.target.value as BrowserPermission }))}>{browserPermissions.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      <div className="space-y-2"><p className="font-semibold">Specific websites</p>{Object.entries(settings.sites).map(([origin, value]) => <div className="flex flex-wrap items-center gap-2" key={origin}><span className="min-w-0 break-all">{origin}</span><button type="button" className={control} onClick={() => update((prev) => { const sites = { ...prev.sites }; delete sites[origin]; return { ...prev, sites }; })}>Remove</button><span className="text-muted">{labels[value]}</span></div>)}
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const url = browserAddress(site); if (!url) return setNotice("Enter an HTTP or HTTPS website address."); update((prev) => ({ ...prev, sites: { ...prev.sites, [url.origin]: permission } })); setSite(""); }}><input aria-label="Website for permission" className={control} value={site} placeholder="example.com" onChange={(e) => setSite(e.target.value)} /><select aria-label="Website permission" className={control} value={permission} onChange={(e) => setPermission(e.target.value as BrowserPermission)}>{browserPermissions.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select><button className={control}>Save website rule</button></form>
      </div><form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const url = browserAddress(address); if (!url) return setNotice("Enter an HTTP or HTTPS website address."); const result = websitePermission(settings, url); if (result === "block") return setNotice(`Website opening is blocked for ${url.origin}.`); if (result === "ask" && !window.confirm(`Open ${url.href} in your browser?`)) return; window.open(url.href, "_blank", "noopener,noreferrer"); }}><input aria-label="Website to open" className={control} value={address} placeholder="https://example.com" onChange={(e) => setAddress(e.target.value)} /><button className={control}>Open website</button></form></>}
    <p role="status" className="text-muted">{notice}</p>
  </section>;
}
