import { useEffect, useState, type ReactNode } from "react";
import { curatedConnectors, parseRegistryPage, registryPageUrl, type ApiListing, type RemoteListing } from "@/lib/mind/connector-directory";

type BrowseMode = "Featured" | "MCP servers" | "API directory";
type RemoteSetup = (label: string, url: string) => void;
const pageSize = 12;

function BrandImage({ src }: { src: string }) {
  const [failed, setFailed] = useState("");
  if (!src || src === failed) return null;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" width={36} height={36}
    className="size-9 shrink-0 rounded-lg bg-white object-contain p-1" onError={() => setFailed(src)} />;
}

function RemoteResults({ query, choose }: { query: string; choose?: RemoteSetup }) {
  const [cursor, setCursor] = useState("");
  const [next, setNext] = useState("");
  const [items, setItems] = useState<RemoteListing[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 12000);
    let mounted = true;
    const delay = window.setTimeout(async () => {
      try {
        const response = await fetch(registryPageUrl(query, cursor), { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
        if (!response.ok) throw new Error("Registry unavailable");
        const page = parseRegistryPage(await response.json());
        if (!mounted) return;
        setItems(previous => {
          const merged = new Map(previous.map(item => [item.id, item]));
          for (const item of page.items) merged.set(item.id, item);
          return [...merged.values()];
        });
        setNext(page.cursor !== cursor ? page.cursor : "");
        setState("ready");
      } catch {
        if (mounted) setState("error");
      } finally {
        window.clearTimeout(deadline);
      }
    }, 300);
    return () => { mounted = false; controller.abort(); window.clearTimeout(delay); window.clearTimeout(deadline); };
  }, [query, cursor, attempt]);
  return <div className="space-y-2">
    <p className="text-xs text-muted">Searches the public MCP Registry. Each listing identifies its publisher and available setup options.</p>
    {items.map(item => <details key={item.id} className="rounded-panel border border-line p-3">
      <summary className="cursor-pointer font-semibold"><span className="inline-flex max-w-full items-center gap-2 align-middle"><BrandImage src={item.logo} /><span className="break-all">{item.title}</span></span></summary>
      <div className="mt-2 space-y-2 break-words text-sm">
        <p className="break-all text-xs text-muted">{item.id}</p>
        {item.description && <p>{item.description}</p>}
        {item.website && <a href={item.website} target="_blank" rel="noreferrer" className="inline-block py-2 text-accent">Publisher information ↗</a>}
        {item.endpoints.length > 0 && choose ? item.endpoints.map(url => <button key={url} type="button" className="block min-h-11 w-full rounded-panel border border-line px-3 text-left" onClick={() => choose(item.title, url)}>Set up endpoint <span className="block break-all text-xs text-muted">{url}</span></button>) :
          <p className="text-xs text-muted">See the publisher’s installation requirements.</p>}
      </div>
    </details>)}
    {state === "loading" && <p role="status" className="text-sm text-muted">Loading servers…</p>}
    {state === "error" && <p role="status" className="text-sm">The registry could not be loaded. <button type="button" className="min-h-11 text-accent" onClick={() => { setState("loading"); setAttempt(n => n + 1); }}>Retry</button></p>}
    {state === "ready" && items.length === 0 && <p className="text-sm text-muted">No active servers on this page.</p>}
    {state === "ready" && next && <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => { setState("loading"); setCursor(next); }}>Load more servers</button>}
  </div>;
}

function ApiResults({ query }: { query: string }) {
  const [rows, setRows] = useState<ApiListing[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [category, setCategory] = useState("");
  const [paging, setPaging] = useState({ query, category, limit: pageSize });
  const limit = paging.query === query && paging.category === category ? paging.limit : pageSize;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch("/catalog/apis.json", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.entries) || data.entries.length === 0) throw new Error();
      if (active) setRows(data.entries);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; controller.abort(); };
  }, [retry]);
  const needle = query.trim().toLowerCase();
  const categories = [...new Set(rows.map(item => item.category).filter(Boolean))].sort();
  const matches = rows.filter(item => (!category || category === item.category) && (item.id + " " + item.title + " " + item.category).toLowerCase().includes(needle));
  if (failed) return <button type="button" className="min-h-11 text-accent" onClick={() => {setFailed(false); setRetry(n => n + 1);}}>Retry loading API directory</button>;
  if (!rows.length) return <p role="status">Loading API directory…</p>;
  return <div className="space-y-3">
    <label className="flex flex-wrap items-center gap-2 text-sm">API category
      <select className="min-h-11 max-w-full rounded-panel border border-line bg-surface px-3" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="">All categories</option>
        {categories.map(name => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
    <p role="status" className="text-sm text-muted">{matches.length.toLocaleString()} of {rows.length.toLocaleString()} API specifications from APIs.guru. Browse the published API contract for each service.</p>
    {matches.slice(0, limit).map(item => <a key={item.id} href={item.specification} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 rounded-panel border border-line p-3">
      <BrandImage src={item.logo} /><span className="min-w-0"><strong>{item.title}</strong><span className="block break-all text-xs text-muted">{item.id} · OpenAPI ↗</span></span></a>)}
    {matches.length > limit && <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setPaging({ query, category, limit: limit + pageSize })}>Show more APIs</button>}
  </div>;
}

export function ConnectorDirectory({ query, choose, openProvider, oauthAction }: { query: string; choose?: RemoteSetup; openProvider: () => void; oauthAction: (name: "Vercel" | "GitHub" | "Notion") => ReactNode }) {
  const [mode, setMode] = useState<BrowseMode>("Featured");
  const needle = query.trim().toLowerCase();
  const featured = curatedConnectors.filter(item => (item.title + " " + item.keywords).toLowerCase().includes(needle));
  return <section className="intelligence-group space-y-3" aria-label="Connector directory">
    <h3>Connector directory</h3>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Browse connector sources">
      {(["Featured", "MCP servers", "API directory"] as const).map(source => <button key={source} type="button" aria-pressed={mode === source}
        className={`min-h-11 rounded-full border border-line px-3 text-sm ${mode === source ? "bg-accent font-semibold text-accent-ink" : ""}`} onClick={() => setMode(source)}>{source}</button>)}
    </div>
    {mode === "Featured" && <div className="grid gap-3 sm:grid-cols-2">
      {featured.map(item => <article key={item.title} className="flex flex-col gap-2 rounded-panel border border-line p-3">
        <div className="flex items-center gap-3"><BrandImage src={`/brand/logos/${item.logo}.svg`} /><h4 className="font-semibold">{item.title}</h4></div>
        <p className="grow text-sm text-muted">{item.description}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {item.endpoint && choose && <button className="min-h-11 font-semibold text-accent" type="button" onClick={() => choose(item.title, item.endpoint)}>Set up connection</button>}
          {item.title === "OpenAI API" && <button className="min-h-11 font-semibold text-accent" type="button" onClick={openProvider}>Set up API key</button>}
          {(item.title === "Vercel" || item.title === "GitHub" || item.title === "Notion") && oauthAction(item.title)}
          <a href={item.website} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent">{item.title === "Vercel" ? "OAuth setup guide ↗" : "Provider guide ↗"}</a>
        </div>
      </article>)}
      {!featured.length && <p className="text-sm text-muted">Search this term in MCP servers or the API directory.</p>}
    </div>}
    {mode === "MCP servers" && <RemoteResults key={needle} query={needle} choose={choose} />}
    {mode === "API directory" && <ApiResults query={query} />}
  </section>;
}
