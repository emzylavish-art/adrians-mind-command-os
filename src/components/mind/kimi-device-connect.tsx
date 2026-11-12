import { useState } from "react";
import { useEffect } from "react";
import { getBearerToken } from "@/lib/auth/client";

type Start = {
  ok?: boolean;
  error?: string;
  state?: string;
  verificationUriComplete?: string;
  userCode?: string;
  detail?: string;
  accountLabel?: string;
  plugins?: { id: string; name: string; description: string }[];
  connection?: { label?: string; state?: string; error?: string };
};

const OFFICIAL = [
  { id: "kimi-datasource", name: "Datasource", mark: "Ds", image: "/brand/marks/datasource.png", color: "#2f6bff", description: "Market, news, company, and legal lookups.", action: "key" as const },
  { id: "kimi-webbridge", name: "Browser", mark: "Br", image: "/brand/marks/browser.png", color: "#f4b400", description: "Drive the browser you already use.", action: "link" as const, href: "https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc" },
  { id: "kimi-computer-use", name: "Computer", mark: "Pc", image: "/brand/marks/computer.png", color: "#34a853", description: "Desktop control for the computer you choose.", action: "link" as const, href: "https://cdn.kimi.com/kimi-computer-use-windows/latest/kimi-cu-win-plugin.zip" },
  { id: "superpowers", name: "Superpowers", mark: "Sp", color: "#d97757", description: "Planning, debugging, and delivery workflows.", action: "link" as const, href: "https://github.com/obra/superpowers" },
  { id: "vercel-plugin", name: "Vercel", mark: "Vc", color: "#111111", description: "Deploy skills and conventions.", action: "link" as const, href: "https://github.com/vercel/vercel-plugin" },
  { id: "modern-web-guidance", name: "Web guidance", mark: "Wb", color: "#1a73e8", description: "Web platform and browser guidance.", action: "link" as const, href: "https://github.com/GoogleChrome/modern-web-guidance" },
  { id: "cloudbase", name: "CloudBase", mark: "Cb", color: "#00a4ff", description: "Database, functions, and hosting.", action: "mcp" as const, href: "https://github.com/TencentCloudBase/CloudBase-AI-Toolkit" },
] as const;

const ADDED_KEY = "adrian-added-plugins";

export function KimiDeviceConnect() {
  const [mode, setMode] = useState<"oauth" | "key">("oauth");
  const [notice, setNotice] = useState("Add a plugin here. The button opens its install step. Nothing is marked connected until that step finishes.");
  const [userCode, setUserCode] = useState("");
  const [url, setUrl] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [plugins, setPlugins] = useState<{ id: string; name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [tab, setTab] = useState<"installed" | "official" | "curated" | "custom">("official");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ADDED_KEY) || "[]");
      if (Array.isArray(saved)) setAdded(saved.filter((item) => typeof item === "string"));
    } catch { /* keep the empty list */ }
  }, []);

  function remember(next: string[]) {
    setAdded(next);
    localStorage.setItem(ADDED_KEY, JSON.stringify(next));
  }

  function addPlugin(plugin: (typeof OFFICIAL)[number]) {
    if (!added.includes(plugin.id)) remember([...added, plugin.id]);
    setTab("custom");
    if (plugin.action === "key") {
      setMode("key");
      setNotice(`${plugin.name} is on Adrian. Paste the key below. It stays on the server and is not shown again.`);
      window.setTimeout(() => document.getElementById("kimi-api-key")?.focus(), 80);
      return;
    }
    if (plugin.action === "mcp") {
      setMode("oauth");
      setNotice(`${plugin.name} is on Adrian. Paste its MCP address below, then press Connect MCP.`);
      window.setTimeout(() => document.getElementById("kimi-mcp-url")?.focus(), 80);
      return;
    }
    setNotice(`${plugin.name} is on Adrian. The install page is open.`);
    if ("href" in plugin && plugin.href) window.open(plugin.href, "_blank", "noopener,noreferrer");
  }

  async function authed(path: string, init?: RequestInit) {
    const token = getBearerToken();
    if (!token) {
      setNotice("Sign in on this site first. Then the server can store the key. The plugin list stays usable without that.");
      return null;
    }
    const response = await fetch(path, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    return (await response.json()) as Start;
  }

  async function call(action: "start" | "poll" | "status") {
    setBusy(true);
    try {
      const body = await authed(action === "status" ? "/api/mind/kimi/providers?view=kimi" : "/api/mind/kimi/providers", {
        method: action === "status" ? "GET" : "POST",
        body: action === "status" ? undefined : JSON.stringify({ action: action === "start" ? "device_start" : "device_poll" }),
      });
      if (!body) return;
      if (!body.ok) {
        setNotice(body.error || "Kimi login did not start.");
        return;
      }
      if (body.verificationUriComplete) {
        setUrl(body.verificationUriComplete);
        setUserCode(body.userCode || "");
        setNotice("Approve this code on Kimi's page, then press Check.");
        window.open(body.verificationUriComplete, "_blank", "noopener,noreferrer");
        return;
      }
      if (body.state === "connected") setNotice(`${body.accountLabel || "Kimi Code"} is connected. The token stays on the server.`);
      else setNotice(body.detail || "Waiting for you to approve the Kimi page.");
      if (Array.isArray(body.plugins)) setPlugins(body.plugins);
    } catch {
      setNotice("Kimi login could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  async function saveKey() {
    if (!apiKey.trim()) return;
    setBusy(true);
    try {
      const body = await authed("/api/mind/kimi/providers", {
        method: "POST",
        body: JSON.stringify({ label: "Kimi Platform", baseUrl: "https://api.kimi.ai/coding/v1", apiKey, model: "kimi-for-coding" }),
      });
      setApiKey("");
      setNotice(body?.ok ? "Kimi API key saved on the server. It is not shown again." : body?.error || "The API key was not saved.");
    } catch {
      setNotice("The API key was not saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMcp() {
    if (!mcpUrl.trim()) return;
    setBusy(true);
    try {
      const body = await authed("/api/mind/kimi/providers", {
        method: "POST",
        body: JSON.stringify({ action: "mcp_save", label: "Custom MCP", url: mcpUrl }),
      });
      const state = body?.connection?.state;
      setNotice(body?.ok ? `MCP ${state || "saved"}. ${body.connection?.error || ""}` : body?.error || "The MCP connection was not saved.");
    } catch {
      setNotice("The MCP connection was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-panel border border-line p-3" aria-label="Plugins">
      <h3 className="font-semibold">Plugins</h3>
      <p className="mt-1 text-sm text-muted">{notice}</p>
      <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Plugin groups">
        {(["installed", "official", "curated", "custom"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={"min-h-11 rounded-panel border px-3 text-sm capitalize " + (tab === item ? "border-accent bg-surface font-semibold" : "border-line")}>
            {item}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2" aria-label="Adrian plugins">
        {(tab === "installed" ? OFFICIAL.filter((plugin) => added.includes(plugin.id)) : tab === "official" ? OFFICIAL.filter((plugin) => plugin.id.startsWith("kimi")) : tab === "curated" ? OFFICIAL.filter((plugin) => !plugin.id.startsWith("kimi")) : []).map((plugin) => {
          const on = added.includes(plugin.id);
          return (
            <article key={plugin.id} className="rounded-panel border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {"image" in plugin ? <img className="service-mark" src={plugin.image} alt="" width={28} height={28} /> : <span className="service-mark" style={{ background: plugin.color, color: "#fff" }} aria-hidden="true">{plugin.mark}</span>}
                  <div className="min-w-0">
                    <p className="font-semibold">{plugin.name}</p>
                    <p className="text-sm text-muted">{plugin.description}</p>
                  </div>
                </div>
                <button type="button" className={"min-h-11 shrink-0 rounded-panel px-4 text-sm font-semibold " + (on ? "border border-line" : "bg-accent text-accent-ink")} onClick={() => on ? remember(added.filter((id) => id !== plugin.id)) : addPlugin(plugin)}>
                  {on ? "Remove" : "Add"}
                </button>
              </div>
            </article>
          );
        })}
        {tab === "installed" && added.length === 0 ? <p className="text-sm text-muted">Nothing is added yet. Open Official or Curated and press Add.</p> : null}
      </div>
      {tab === "custom" ? <div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" aria-pressed={mode === "oauth"} onClick={() => setMode("oauth")}>Coding login</button>
        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" aria-pressed={mode === "key"} onClick={() => setMode("key")}>API key</button>
      </div>
      {mode === "oauth" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={busy} onClick={() => void call("start")}>Connect coding account</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy} onClick={() => void call("poll")}>Check</button>
          {url ? <a className="inline-flex min-h-11 items-center px-3 text-sm underline" href={url} target="_blank" rel="noreferrer">Open the login page</a> : null}
          {userCode ? <p className="w-full font-mono text-sm">Code: {userCode}</p> : null}
        </div>
      ) : (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
          <input id="kimi-api-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" autoComplete="off" placeholder="Coding platform API key" className="min-h-11 min-w-64 flex-1 rounded-panel border border-line bg-bg px-3 text-sm" />
          <button type="submit" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy}>Save API key</button>
        </form>
      )}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveMcp(); }}>
        <input id="kimi-mcp-url" value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://your-mcp.example/mcp" className="min-h-11 min-w-64 flex-1 rounded-panel border border-line bg-bg px-3 text-sm" />
        <button type="submit" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy}>Connect MCP</button>
      </form>
      </div> : null}
      {plugins.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {plugins.map((plugin) => <li key={plugin.id || plugin.name}>{plugin.name}{plugin.description ? `. ${plugin.description}` : ""}</li>)}
        </ul>
      ) : null}
    </section>
  );
}
