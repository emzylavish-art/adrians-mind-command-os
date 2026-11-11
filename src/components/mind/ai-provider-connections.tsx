import { useEffect, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import type { PublicAiProvider } from "@/lib/mind/ai-provider-config.server";

type PublicRow = PublicAiProvider;
type ProviderKind = "openai" | "xai" | "openrouter" | "anthropic" | "gemini" | "compatible";

const PRESETS: Record<ProviderKind, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  compatible: "",
};

async function api(action: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  const token = getBearerToken();
  const response = await fetch("/api/mind/providers", {
    method: action ? "POST" : "GET",
    credentials: "same-origin",
    headers: { ...(action ? { "content-type": "application/json" } : {}), ...(token ? { authorization: "Bearer " + token } : {}) },
    ...(action ? { body: JSON.stringify(action) } : {}),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok || result.ok !== true) throw new Error(typeof result.error === "string" ? result.error : "Provider request failed.");
  return result;
}

/** Account-owned, server-encrypted API configurations. Never echoes or stores secret input. */
export function AiProviderConnections({ onChange }: { onChange?: (rows: PublicRow[]) => void }) {
  const [rows, setRows] = useState<PublicRow[]>([]);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [label, setLabel] = useState("OpenAI");
  const [baseUrl, setBaseUrl] = useState(PRESETS.openai);
  const [apiKey, setApiKey] = useState("");
  const [initialModel, setInitialModel] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("API keys are encrypted on the server. Adding a provider never makes a paid inference request.");
  const load = async () => {
    const data = await api(null);
    const next = Array.isArray(data.providers) ? data.providers as PublicRow[] : [];
    setRows(next);
    onChange?.(next);
  };
  useEffect(() => { void load().catch(() => setNotice("Sign in to load your saved AI providers.")); }, []);
  useEffect(() => {
    const open = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      const kindByName: Record<string, ProviderKind> = { OpenAI: "openai", Claude: "anthropic", Gemini: "gemini", OpenRouter: "openrouter" };
      const next = name ? kindByName[name] : undefined;
      if (!next) return;
      setKind(next);
      setBaseUrl(PRESETS[next]);
      setLabel(next === "openrouter" ? "OpenRouter" : next === "openai" ? "OpenAI" : next === "anthropic" ? "Anthropic" : "Gemini");
      window.setTimeout(() => document.getElementById("owner-api-key")?.focus(), 50);
    };
    window.addEventListener("adrian-open-connect", open);
    return () => window.removeEventListener("adrian-open-connect", open);
  }, []);
  async function run(action: Record<string, unknown>, success: string) {
    if (loading) return;
    setLoading(true);
    setNotice("Saving or checking provider…");
    try {
      const data = await api(action);
      if (action.action === "save") setApiKey("");
      await load();
      const provider = data.provider as PublicRow | undefined;
      setNotice(provider?.lastError ? success + " " + provider.lastError : success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The provider operation did not complete.");
    } finally { setLoading(false); }
  }
  return (
    <section id="owner-api-connect" className="settings-card rounded-panel p-4 text-sm" aria-label="Custom AI API providers" data-testid="custom-ai-providers">
      <h3 className="font-semibold">Custom AI APIs and models</h3>
      <p className="mt-1 text-muted">Connect OpenAI-compatible, Anthropic or Gemini APIs, discover supported models, then choose a model from chat. Your key is encrypted on the server. Some providers require a manually entered model ID.</p>
      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        void run({ action: "save", label, baseUrl, apiKey, model: initialModel }, "Provider saved. You can refresh its models without using chat credits.");
      }}>
        <label className="grid gap-1">
          <span>Provider type</span>
          <select value={kind} className="min-h-11 rounded-panel border border-line bg-bg px-3" onChange={(event) => {
            const next = event.target.value as ProviderKind;
            setKind(next);
            setBaseUrl(PRESETS[next]);
            setLabel(next === "xai" ? "xAI" : next === "openrouter" ? "OpenRouter" : next === "openai" ? "OpenAI" : next === "anthropic" ? "Anthropic" : next === "gemini" ? "Gemini" : "Custom API");
          }}>
            <option value="openai">OpenAI</option>
            <option value="xai">xAI / Grok</option>
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic (native API)</option>
            <option value="gemini">Google Gemini (native API)</option>
            <option value="compatible">Custom OpenAI-compatible API</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span>Connection name</span>
          <input required value={label} onChange={(event) => setLabel(event.target.value)} className="min-h-11 rounded-panel border border-line bg-bg px-3" />
        </label>
        <label className="grid gap-1 md:col-span-2">
          <span>HTTPS API base URL</span>
          <input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" className="min-h-11 rounded-panel border border-line bg-bg px-3" />
        </label>
        <label className="grid gap-1">
          <span>API key</span>
          <input id="owner-api-key" required type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Enter key (never displayed again)" className="min-h-11 rounded-panel border border-line bg-bg px-3" />
        </label>
        <label className="grid gap-1">
          <span>Initial model ID (optional)</span>
          <input value={initialModel} onChange={(event) => setInitialModel(event.target.value)} placeholder="Discovered automatically, or enter ID" className="min-h-11 rounded-panel border border-line bg-bg px-3" />
        </label>
        <button disabled={loading || !apiKey.trim() || !baseUrl.trim()} type="submit" className="min-h-11 rounded-panel bg-accent px-4 font-semibold text-accent-ink md:col-span-2">
          {loading ? "Working…" : "Connect API and discover models"}
        </button>
      </form>
      <p className="mt-3 text-xs text-muted" role="status">{notice}</p>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <article key={row.id} className="rounded-panel border border-line p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div><p className="font-semibold">{row.label}</p><p className="text-xs text-muted">{row.host} · {row.status} · {row.models.length} model(s)</p></div>
              <div className="flex gap-2">
                <button type="button" disabled={loading} onClick={() => void run({ action: "discover", id: row.id }, "Model catalogue refreshed.")} className="rounded-panel border border-line px-3 py-2">Refresh models</button>
                <button type="button" disabled={loading} onClick={() => {
                  if (confirm("Remove this AI API connection?")) void run({ action: "delete", id: row.id }, "Connection removed.");
                }} className="rounded-panel border border-line px-3 py-2">Remove</button>
              </div>
            </div>
            {row.lastError && <p role="status" className="mt-2 text-xs text-muted">{row.lastError}</p>}
            <p className="mt-2 text-xs text-muted">Default model: {row.defaultModel || "Select a model after discovery"}</p>
            {row.models.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{row.models.slice(0, 30).map((id) => <span key={id} className="rounded-panel border border-line px-2 py-1 text-xs">{id}</span>)}</div>}
            <form className="mt-3 flex gap-2" onSubmit={(event) => {
              event.preventDefault();
              void run({ action: "model", id: row.id, model: manual[row.id] || "" }, "Model added and selected.");
            }}>
              <input aria-label={"Manual model for " + row.label} value={manual[row.id] || ""} onChange={(event) => setManual((old) => ({ ...old, [row.id]: event.target.value }))} placeholder="Additional model ID" className="min-w-0 flex-1 rounded-panel border border-line bg-bg px-3" />
              <button disabled={loading || !(manual[row.id] || "").trim()} type="submit" className="rounded-panel border border-line px-3 py-2">Add model</button>
            </form>
          </article>
        ))}
        {rows.length === 0 && <p className="text-xs text-muted">No custom AI API is saved yet.</p>}
      </div>
    </section>
  );
}
