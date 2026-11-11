import { useState } from "react";
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
  ["Kimi Datasource", "Market, news, company, and legal lookups. Runs after Kimi login."],
  ["Kimi Browser Extension", "Drives the browser you already use. Needs the extension installed."],
  ["Kimi Computer Use", "Desktop control on macOS or Windows. Not a Vercel process."],
] as const;

export function KimiDeviceConnect() {
  const [mode, setMode] = useState<"oauth" | "key">("oauth");
  const [notice, setNotice] = useState("This is Kimi's own login. No password is typed here.");
  const [userCode, setUserCode] = useState("");
  const [url, setUrl] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [plugins, setPlugins] = useState<{ id: string; name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function authed(path: string, init?: RequestInit) {
    const token = getBearerToken();
    if (!token) {
      setNotice("Sign in to Adrian OS first. Then use Kimi's login.");
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
    <section className="mt-6 rounded-panel border border-line p-3" aria-label="Kimi login">
      <h3 className="font-semibold">Kimi login</h3>
      <p className="mt-1 text-sm text-muted">{notice}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" aria-pressed={mode === "oauth"} onClick={() => setMode("oauth")}>Kimi Code</button>
        <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" aria-pressed={mode === "key"} onClick={() => setMode("key")}>API key</button>
      </div>
      {mode === "oauth" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={busy} onClick={() => void call("start")}>Connect Kimi Code</button>
          <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy} onClick={() => void call("poll")}>Check</button>
          {url ? <a className="inline-flex min-h-11 items-center px-3 text-sm underline" href={url} target="_blank" rel="noreferrer">Open Kimi login</a> : null}
          {userCode ? <p className="w-full font-mono text-sm">Code: {userCode}</p> : null}
        </div>
      ) : (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveKey(); }}>
          <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" autoComplete="off" placeholder="Kimi platform API key" className="min-h-11 min-w-64 flex-1 rounded-panel border border-line bg-bg px-3 text-sm" />
          <button type="submit" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy}>Save API key</button>
        </form>
      )}
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void saveMcp(); }}>
        <input value={mcpUrl} onChange={(event) => setMcpUrl(event.target.value)} placeholder="https://your-mcp.example/mcp" className="min-h-11 min-w-64 flex-1 rounded-panel border border-line bg-bg px-3 text-sm" />
        <button type="submit" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy}>Connect MCP</button>
      </form>
      <ul className="mt-3 space-y-1 text-sm text-muted">
        {OFFICIAL.map(([name, detail]) => <li key={name}>{name}. {detail}</li>)}
        <li>Skills, hooks, and subagents stay on the Kimi runtime. This page does not pretend they already ran.</li>
      </ul>
      {plugins.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {plugins.map((plugin) => <li key={plugin.id || plugin.name}>{plugin.name}{plugin.description ? `. ${plugin.description}` : ""}</li>)}
        </ul>
      ) : null}
    </section>
  );
}
