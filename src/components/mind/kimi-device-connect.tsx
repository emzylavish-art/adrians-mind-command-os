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
  { id: "superpowers", name: "Superpowers", mark: "Sp", image: "", color: "#d97757", description: "Planning, debugging, and delivery workflows.", action: "link" as const, href: "https://github.com/obra/superpowers" },
  { id: "vercel-plugin", name: "Vercel", mark: "Vc", image: "/brand/logos/vercel.svg", color: "#111111", description: "Deploy skills and conventions.", action: "link" as const, href: "https://github.com/vercel/vercel-plugin" },
  { id: "modern-web-guidance", name: "Web guidance", mark: "Wb", image: "", color: "#1a73e8", description: "Web platform and browser guidance.", action: "link" as const, href: "https://github.com/GoogleChrome/modern-web-guidance" },
  { id: "cloudbase", name: "CloudBase", mark: "Cb", image: "", color: "#00a4ff", description: "Database, functions, and hosting.", action: "mcp" as const, href: "https://github.com/TencentCloudBase/CloudBase-AI-Toolkit" },
] as const;

const ADDED_KEY = "adrian-added-plugins";

export function KimiDeviceConnect() {
  const [notice, setNotice] = useState("Build uses the saved Grok key. There is no separate coding login.");
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
    if (plugin.action === "mcp") {
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

  async function saveMcp() {
    if (!mcpUrl.trim()) return;
    setBusy(true);
    try {
      const body = await authed("/api/mind/build/providers", {
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
      <div className="mt-3 grid gap-2" role="group" aria-label="Adrian plugins">
        {(tab === "installed" ? OFFICIAL.filter((plugin) => added.includes(plugin.id)) : tab === "official" ? [] : tab === "curated" ? OFFICIAL : []).map((plugin) => {
          const on = added.includes(plugin.id);
          return (
            <article key={plugin.id} className="plugin-link">
              <div className="plugin-link__main">
                {plugin.image.endsWith(".svg") ? <img className="service-mark" src={plugin.image} alt="" width={28} height={28} /> : <span className="service-mark" style={{ background: plugin.color, color: "#fff" }} aria-hidden="true">{plugin.mark}</span>}
                <div className="min-w-0">
                  <a className="inline-flex min-h-11 items-center font-semibold underline" href={plugin.href} target="_blank" rel="noreferrer">{plugin.name}</a>
                  <p className="text-sm text-muted">{plugin.description}</p>
                </div>
              </div>
              <div className="plugin-link__action">
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
      <p className="mt-3 text-sm text-muted">There is no separate coding login on this page. A coding task uses the Grok key already saved for Adrian.</p>
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
