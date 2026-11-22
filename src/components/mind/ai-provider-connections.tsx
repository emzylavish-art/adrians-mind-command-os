import { useEffect, useState } from "react";
import { ActionOverlay } from "@/components/mind/conversation-menu";
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

const PROVIDER_LOGOS: Partial<Record<ProviderKind, string>> = {
  openai: "/brand/logos/openai.svg",
  xai: "/brand/logos/grok.svg",
  openrouter: "/brand/logos/openrouter.svg",
  anthropic: "/brand/logos/claude.svg",
  gemini: "/brand/logos/gemini.svg",
};

function providerLogo(label: string) {
  const name = label.toLowerCase();
  if (name.includes("openrouter")) return PROVIDER_LOGOS.openrouter;
  if (name.includes("anthropic") || name.includes("claude")) return PROVIDER_LOGOS.anthropic;
  if (name.includes("gemini")) return PROVIDER_LOGOS.gemini;
  if (name.includes("xai") || name.includes("grok")) return PROVIDER_LOGOS.xai;
  if (name.includes("openai")) return PROVIDER_LOGOS.openai;
  return null;
}

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
export function AiProviderConnections({ onChange, onUseModel }: { onChange?: (rows: PublicRow[]) => void; onUseModel?: (choice: string) => void }) {
  const [rows, setRows] = useState<PublicRow[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [label, setLabel] = useState("OpenAI");
  const [baseUrl, setBaseUrl] = useState(PRESETS.openai);
  const [apiKey, setApiKey] = useState("");
  const [initialModel, setInitialModel] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState("API keys are encrypted on the server. Adding a provider never makes a paid inference request.");
  const load = async () => {
    const data = await api(null);
    const next = Array.isArray(data.providers) ? data.providers as PublicRow[] : [];
    setRows(next);
    setLoadedOnce(true);
    onChange?.(next);
  };
  useEffect(() => {
    void load().catch((error) => {
      setNotice(error instanceof Error ? error.message : "Saved AI providers could not be loaded.");
    });
  }, []);
  useEffect(() => {
    const open = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      const kindByName: Record<string, ProviderKind> = { OpenAI: "openai", Claude: "anthropic", Gemini: "gemini", OpenRouter: "openrouter" };
      const next = name ? kindByName[name] : undefined;
      if (!next) return;
      setKind(next);
      setApiKey("");
      setInitialModel("");
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
      try {
        await load();
      } catch {
        setLoadedOnce(false);
        setNotice(`${success} Couldn’t refresh your connections.`);
        return;
      }
      const provider = data.provider as PublicRow | undefined;
      setNotice(provider?.lastError ? success + " " + provider.lastError : success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The provider operation did not complete.");
    } finally { setLoading(false); }
  }
  return (
    <section id="owner-api-connect" className="settings-card adrian-layer rounded-panel p-4 text-sm" aria-label="Custom AI API providers" data-testid="custom-ai-providers">
      <h3 className="font-semibold">Custom AI APIs and models</h3>
      <p className="mt-1 text-muted">Connect OpenAI-compatible, Anthropic or Gemini APIs, discover supported models, then choose a model from chat. Your key is encrypted on the server. Some providers require a manually entered model ID.</p>
      <div className="provider-identity mt-4" aria-live="polite">
        {PROVIDER_LOGOS[kind] ? <img src={PROVIDER_LOGOS[kind]} alt="" width={28} height={28} /> : <span className="provider-identity__custom" aria-hidden="true">API</span>}
        <div><p className="font-semibold">{label || "Custom API"}</p><p className="text-xs text-muted">Select a provider, then add only the credentials you intend to use.</p></div>
      </div>
      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        void run({ action: "save", label, baseUrl, apiKey, model: initialModel }, "Provider saved. You can refresh its models without using chat credits.");
      }}>
        <label className="grid gap-1">
          <span>Provider type</span>
          <select value={kind} className="min-h-11 rounded-panel border border-line bg-bg px-3" onChange={(event) => {
            const next = event.target.value as ProviderKind;
            setKind(next);
            setApiKey("");
            setInitialModel("");
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
          <input required type="url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setApiKey(""); setInitialModel(""); }} placeholder="https://api.example.com/v1" className="min-h-11 rounded-panel border border-line bg-bg px-3" />
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
      {!loadedOnce && <button type="button" disabled={loading} className="mt-2 min-h-11 rounded-panel border border-line px-3" onClick={() => void load().then(() => setNotice("Connections refreshed.")).catch((error) => setNotice(error.message))}>Retry refresh</button>}
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="adrian-layer rounded-panel border border-line p-3"
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button, select, input")) return;
              const timer = window.setTimeout(() => setRowMenu(row.id), 550);
              event.currentTarget.dataset.hold = String(timer);
            }}
            onPointerUp={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
            onPointerLeave={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
            onPointerCancel={(event) => window.clearTimeout(Number(event.currentTarget.dataset.hold))}
          >
            <div className="flex min-w-0 items-start gap-3">{providerLogo(`${row.label} ${row.host}`) ? <img className="size-7 shrink-0 rounded" src={providerLogo(`${row.label} ${row.host}`)!} alt="" width={28} height={28} /> : <span className="provider-identity__custom shrink-0" aria-hidden="true">API</span>}<div><p className="font-semibold">{row.label}</p><p className="text-xs text-muted">{row.host} · {row.status} · {row.models.length} model(s) · Hold for actions</p></div></div>
            {row.lastError && <p role="status" className="mt-2 text-xs text-muted">{row.lastError}</p>}
            {row.models.length > 0 && <label className="mt-3 block text-sm">Default model
              <select disabled={loading} value={row.defaultModel || ""} className="mt-1 block min-h-11 w-full rounded-panel border border-line bg-bg px-2" onChange={(event) => void run({ action: "model", id: row.id, model: event.target.value }, "Default model updated.")}>
                <option value="" disabled>Choose a model</option>
                {[...new Set([...(row.defaultModel ? [row.defaultModel] : []), ...row.models])].map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>}
            {row.models.length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted">{row.models.length} models. Free text models are first. The list is not shortened.</p>
                <ul aria-label={row.label + " models"} className="mt-2 grid max-h-64 gap-2 overflow-y-auto p-1" style={{ overflowX: "hidden" }}>
                  {row.models.map((id, index) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="adrian-row flex min-h-11 w-full items-center gap-3 rounded-2xl border border-line px-3 text-left text-xs"
                        aria-pressed={row.defaultModel === id}
                        onClick={() => void run({ action: "model", id: row.id, model: id }, "Default model updated.")}
                      >
                        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-[0.7rem]">{index + 1}</span>
                        <span className="min-w-0 flex-1 break-all">{id}</span>
                        {id.endsWith(":free") ? <span className="shrink-0 rounded-full border border-line px-2 py-1">free</span> : null}
                        <span className="shrink-0 rounded-full border border-line px-2 py-1" onClick={(event) => { event.stopPropagation(); onUseModel?.(`custom:${row.id}:${encodeURIComponent(id)}`); }}>Use in chat</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <form className="mt-3 flex gap-2" onSubmit={(event) => {
              event.preventDefault();
              void run({ action: "model", id: row.id, model: manual[row.id] || "" }, "Model added and selected.");
            }}>
              <input aria-label={"Manual model for " + row.label} value={manual[row.id] || ""} onChange={(event) => setManual((old) => ({ ...old, [row.id]: event.target.value }))} placeholder="Additional model ID" className="min-w-0 flex-1 rounded-panel border border-line bg-bg px-3" />
              <button disabled={loading || !(manual[row.id] || "").trim()} type="submit" className="rounded-panel border border-line px-3 py-2">Add model</button>
            </form>
          </article>
        ))}
        {rowMenu && rows.some((row) => row.id === rowMenu) ? (
          <ActionOverlay label={`Actions for ${rows.find((row) => row.id === rowMenu)?.label || "connection"}`} title={rows.find((row) => row.id === rowMenu)?.label || "Connection"} onClose={() => setRowMenu(null)}>
            <button type="button" disabled={loading} className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" onClick={() => { const id = rowMenu; setRowMenu(null); void run({ action: "discover", id }, "Model catalogue refreshed."); }}>Refresh models</button>
            <button type="button" disabled={loading} className="flex min-h-11 w-full items-center rounded-2xl px-3 text-left text-sm" style={{ color: "rgb(248 113 113)" }} onClick={() => { const id = rowMenu; setRowMenu(null); if (confirm("Remove this AI API connection?")) void run({ action: "delete", id }, "Connection removed."); }}>Remove</button>
          </ActionOverlay>
        ) : null}
        {loadedOnce && rows.length === 0 && <p className="text-xs text-muted">No custom AI API is saved yet.</p>}
      </div>
    </section>
  );
}
