import { AudioLines, Image, Monitor, Search, Cpu } from "lucide-react";
import { ConnectorDirectory } from "./connector-directory";
import { rememberOAuthReturn } from "@/lib/mind/connectors/oauth-return";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
import { focusConnection } from "./focus-connection";
import { NotionWorkspaces } from "./notion-workspaces";
import { KimiDeviceConnect } from "@/components/mind/kimi-device-connect";
import { checkMcpStorage } from "@/lib/mind/mcp-storage-status";
import { oauthBoardState } from "@/lib/mind/connection-board";
import {
  OAUTH_STATUS_FETCH_TIMEOUT_MS,
  fetchOauthStatusPayload,
  isStatusUnavailable,
  type OauthStatusPayload,
} from "@/lib/mind/service-board-status";
import {
  OauthBoardActionStatusRows,
  onceRetry,
  runOauthBoardAction,
  snapshotOauthBoardActionParams,
  type OauthBoardActionState,
} from "@/lib/mind/oauth-board-action";

type Service = {
  name: string;
  state: string;
  detail: string;
};

function ServiceMark({ name }: { name: string }) {
  const files: Record<string, string> = {
    Grok: "/brand/logos/grok.svg",
    Notion: "/brand/logos/notion.svg",
    GitHub: "/brand/logos/github.svg",
    Vercel: "/brand/logos/vercel.svg",
    Gmail: "/brand/logos/gmail.svg",
    "Google Drive": "/brand/logos/drive.svg",
    "Google Docs": "/brand/logos/docs.svg",
    "Google Calendar": "/brand/logos/calendar.svg",
    YouTube: "/brand/logos/youtube.svg",
    Slack: "/brand/logos/slack.svg",
    OpenAI: "/brand/logos/openai.svg",
    Claude: "/brand/logos/claude.svg",
    Gemini: "/brand/logos/gemini.svg",
    OpenRouter: "/brand/logos/openrouter.svg",
    MCP: "/brand/logos/mcp.svg",
  };
  const file = name === "Nemotron" ? "/brand/logos/nvidia.svg" : files[name];
  const tile = ["OpenAI", "GitHub", "MCP", "Notion", "Grok"].includes(name);
  if (file) return <img className={tile ? "service-mark on-tile" : "service-mark"} src={file} alt="" width={28} height={28} />;
  const symbols = { Voice: AudioLines, "Image and video": Image, "Local computer": Monitor, "Web search": Search, "Local model": Cpu };
  const Symbol = symbols[name as keyof typeof symbols];
  return Symbol ? <Symbol aria-hidden="true" className="size-7 shrink-0 text-muted" /> : null;
}

const SERVICES: Service[] = [
  { name: "Notion", state: "Not connected", detail: "No Notion OAuth. Nothing can be searched or updated." },
  { name: "GitHub", state: "Not connected", detail: "No repository connection. Nothing can be pushed." },
  { name: "Vercel", state: "Not connected", detail: "Connect to review the projects and tools available to your Vercel account." },
  { name: "Gmail", state: "Not connected", detail: "No mailbox is connected. Nothing is read or sent." },
  { name: "Google Drive", state: "Not connected", detail: "No Drive connection. No files are listed." },
  { name: "Google Docs", state: "Not connected", detail: "No Docs connection." },
  { name: "Google Calendar", state: "Not connected", detail: "No Calendar connection." },
  { name: "YouTube", state: "Not connected", detail: "No YouTube connection." },
  { name: "Slack", state: "Not connected", detail: "Slack is not configured." },
  { name: "OpenAI", state: "Not configured", detail: "No API key. A chat subscription is not used." },
  { name: "Claude", state: "Not configured", detail: "No API key. Nothing is sent to Anthropic." },
  { name: "Gemini", state: "Not configured", detail: "No API key. Nothing is sent to Google." },
  { name: "OpenRouter", state: "Not connected", detail: "No OpenRouter key is on this server. It is not shown in the model selector." },
  { name: "Nemotron", state: "Not connected", detail: "Nemotron needs an OpenRouter key. It is not shown in the model selector." },
  { name: "Local model", state: "Not connected", detail: "No local runner is configured. It is not shown in the model selector." },
  { name: "Web search", state: "Not configured", detail: "No search endpoint. No citations are created." },
  { name: "Image and video", state: "Ready when the server key is set", detail: "Ask in chat with /imagine. The server uses the Grok image model. Nothing is generated until you ask." },
  { name: "Voice", state: "Not configured", detail: "No speech key and no Grok model key. Nothing was started." },
  { name: "MCP", state: "Not connected", detail: "No MCP server has answered a handshake. Nothing is called." },
  { name: "Local computer", state: "Not paired", detail: "No HP laptop or phone is paired. No files are changed." },
];

type OauthStatus = OauthStatusPayload;

/** ServiceBoard row name → OAuth API connector id (Notion keeps dedicated routes). */
const OAUTH_BOARD: Record<string, { connector: string; path: string; messageType: string }> = {
  Notion: { connector: "notion", path: "notion", messageType: "notion-oauth" },
  Gmail: { connector: "gmail", path: "gmail", messageType: "gmail-oauth" },
  "Google Calendar": { connector: "google_calendar", path: "google_calendar", messageType: "google_calendar-oauth" },
  "Google Drive": { connector: "google_drive", path: "google_drive", messageType: "google_drive-oauth" },
  YouTube: { connector: "youtube", path: "youtube", messageType: "youtube-oauth" },
  Slack: { connector: "slack", path: "slack", messageType: "slack-oauth" },
  GitHub: { connector: "github", path: "github", messageType: "github-oauth" },
  Vercel: { connector: "vercel", path: "vercel", messageType: "vercel-oauth" },
};

function boardForOauth(name: string, oauth: OauthStatus | null | undefined, legacy?: { state: string; detail: string } | null) {
  void name;
  return oauthBoardState(oauth, legacy);
}


export function ServiceBoard({
  grokConfigured,
  providers = [],
  savedMcp = [],
  onSetup,
  mcp,
  localComputer,
  onDisconnect,
  onFailure,
  onOpenConnect,
  onChooseRemote,
  oauthReturnTo,
  temporaryDraft,
}: {
  grokConfigured: boolean | null;
  providers?: { id: string; label: string; defaultModel: string; host: string; hasKey: boolean; status: string }[];
  savedMcp?: { id: string; label: string; state: string; tools: { name: string }[] }[];
  onSetup: (message: string) => void;
  notion?: { state: string; detail: string } | null;
  mcp?: { state: string; detail: string } | null;
  localComputer?: { state: string; detail: string } | null;
  onDisconnect?: () => void;
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
  /** Opens the paste form for a card. Setup must not only repeat a sentence. */
  onOpenConnect?: (name: string) => void;
  onChooseRemote?: (label: string, url: string) => void;
  oauthReturnTo?: string;
  temporaryDraft?: boolean;
}) {
  const [oauthByName, setOauthByName] = useState<Record<string, OauthStatus | null | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [note, setNote] = useState<{ name: string; text: string } | null>(null);
  const [oauthActionState, setOauthActionState] = useState<OauthBoardActionState>({ status: "idle" });
  const [mcpStorage, setMcpStorage] = useState<{ state: "checking" | "ready" | "error"; detail: string } | null>(null);
  const [showWaiting, setShowWaiting] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const inFlight = useRef(new Map<string, AbortController>());

  const refreshOne = useCallback((name: string) => {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    inFlight.current.get(name)?.abort();
    const probe = new AbortController();
    inFlight.current.set(name, probe);
    setRefreshing(name);
    // Always resolves: 401/403/5xx, network, non-JSON, and a hung probe become a terminal unavailable status.
    void fetchOauthStatusPayload(`/api/mind/oauth/${meta.path}/status`, {
      timeoutMs: OAUTH_STATUS_FETCH_TIMEOUT_MS,
      signal: probe.signal,
      bearer: getBearerToken(),
    })
      .then((status) => {
        if (inFlight.current.get(name) === probe) setOauthByName((prev) => ({ ...prev, [name]: status }));
      })
      .finally(() => {
        if (inFlight.current.get(name) !== probe) return;
        inFlight.current.delete(name);
        setRefreshing((current) => (current === name ? null : current));
      });
  }, []);

  const refreshAll = useCallback(() => {
    for (const name of Object.keys(OAUTH_BOARD)) refreshOne(name);
  }, [refreshOne]);

  useEffect(() => {
    refreshAll();
    const onMsg = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== "object") return;
      const type = (event.data as { type?: string }).type;
      if (!type) return;
      for (const [name, meta] of Object.entries(OAUTH_BOARD)) {
        if (type === meta.messageType) refreshOne(name);
      }
    };
    window.addEventListener("message", onMsg);
    const probes = inFlight.current;
    return () => {
      window.removeEventListener("message", onMsg);
      for (const probe of probes.values()) probe.abort();
      probes.clear();
    };
  }, [refreshAll, refreshOne]);

  const grok: Service = grokConfigured === null
    ? { name: "Grok", state: "Status unavailable", detail: "The account’s provider status has not been verified." }
    : grokConfigured
    ? { name: "Grok", state: "Key present", detail: "Fast, Expert, and Heavy use the server key when you press Send. This page has not verified a reply." }
    : { name: "Grok", state: "Not configured", detail: "No server key is visible to this page." };

  const services = SERVICES.map((service) => {
    if (service.name === "Voice" && grokConfigured) {
      return { name: "Voice", state: "Key present", detail: "Speak uses the Grok model key when no separate speech key is set. A session starts only when you press Speak." };
    }
    if (service.name === "MCP" && mcp) {
      return { name: "MCP", state: mcp.state, detail: mcp.detail };
    }
    const meta = OAUTH_BOARD[service.name];
    if (!meta) return service;
    const legacy = null;
    const board = boardForOauth(service.name, oauthByName[service.name], legacy);
    return { name: service.name, state: board.state, detail: board.detail };
  });

  function runOauthAction(params: ReturnType<typeof snapshotOauthBoardActionParams>, returnTo?: string) {
    if (params.action === "connect" && temporaryDraft) {
      setNote({ name: params.name, text: "Finish your temporary draft before connecting an account. The provider sign-in reloads this tab." });
      return;
    }
    setBusy(params.name);
    setNote(null);
    setOauthActionState({ status: "running", action: params.action, name: params.name });
    const run = () => {
      setBusy(params.name);
      setOauthActionState({ status: "running", action: params.action, name: params.name });
      void runOauthBoardAction(params, (url, init) => {
        const headers = new Headers(init.headers);
        const bearer = getBearerToken();
        if (bearer) headers.set("authorization", `Bearer ${bearer}`);
        return fetch(url, { ...init, headers });
      }).then((result) => {
        if (result.ok) {
          setOauthActionState({ status: "ok", note: result.note, name: result.name, redirectUrl: result.redirectUrl });
          if (params.action === "connect" && result.redirectUrl) {
            try { rememberOAuthReturn(window.sessionStorage, params.path, result.redirectUrl, returnTo || oauthReturnTo || window.location.pathname + window.location.search); } catch { /* The provider callback can still return home. */ }
            window.location.assign(result.redirectUrl);
            return;
          }
          if (params.action === "disconnect") {
            if (result.oauth) {
              setOauthByName((prev) => ({ ...prev, [params.name]: result.oauth! }));
            }
            setNote({ name: params.name, text: result.note });
            if (params.name === "Notion") onDisconnect?.();
            refreshOne(params.name);
          }
          setBusy(null);
          return;
        }
        setOauthActionState({
          status: "error",
          kind: result.kind,
          message: result.message,
          params: result.params,
        });
        setNote(null);
        setBusy(null);
        const retry = onceRetry(() => run());
        if (retry) onFailure?.(result.message, retry);
        // Keep Setup notice for connect failures (legacy surface) without replacing the red banner.
        if (params.action === "connect") onSetup(result.message);
      });
    };
    run();
  }

  function verifyMcpStorage() {
    setMcpStorage({ state: "checking", detail: "Checking the authenticated MCP database and migrations…" });
    void checkMcpStorage({ bearerToken: getBearerToken() }).then((result) => {
      setMcpStorage({ state: result.state, detail: result.detail });
    });
  }

  function connectOauth(name: string, returnTo?: string) {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    runOauthAction(snapshotOauthBoardActionParams({ action: "connect", name, path: meta.path }), returnTo);
  }

  function disconnectOauth(name: string) {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    runOauthAction(snapshotOauthBoardActionParams({ action: "disconnect", name, path: meta.path, expectedConnectedAt: oauthByName[name]?.connectedAt }));
  }

  function openSavedRow(id: string) {
    const node = document.getElementById(id);
    const details = node?.closest("details");
    if (details) details.open = true;
    node?.scrollIntoView({ block: "center" });
    node?.focus({ preventScroll: true });
  }

  function explainOrOpen(name: string, detail: string) {
    onOpenConnect?.(name);
    onSetup(detail);
  }

  return (
    <div className="intelligence-main" data-testid="plugins-pane">
    {(() => {
      const readyState = (state: string) => state === "Key present" || state === "Connected" || state === "API token present";
      const rows = services.filter((service) => catalogBand(service.name) !== "Models");
      const unresolved = (state: string) => state === "Checking" || state === "Status unavailable" || state.includes("review access");
      const connected = rows.filter((service) => (readyState(service.state) || oauthByName[service.name]?.state === "connected") && catalogBand(service.name) !== "Models");
      const waiting = rows.filter((service) => !connected.includes(service) && !unresolved(service.state));
      const needle = catalogQuery.trim().toLowerCase();
      const matchesSearch = (service: Service) => !needle || `${service.name} ${service.detail}`.toLowerCase().includes(needle);
      const foundProviders = providers.filter((row) => [row.label, row.host, row.defaultModel].join(" ").toLowerCase().includes(needle));
      const foundMcp = savedMcp.filter((row) => [row.label, ...row.tools.map((tool) => tool.name)].join(" ").toLowerCase().includes(needle));
      const checking = rows.filter((service) => !connected.includes(service) && unresolved(service.state) && matchesSearch(service));
      const catalog = waiting.filter((service) => !needle || `${service.name} ${service.detail}`.toLowerCase().includes(needle));
      const bands = ["Communication", "Productivity", "Developer", "Models", "Research and media", "Custom MCP", "Other"]
        .map((label) => ({ label, items: catalog.filter((service) => catalogBand(service.name) === label) }))
        .filter((band) => band.items.length > 0);
      return (
        <>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Search plugins" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search plugins, providers and APIs" className="min-h-11 flex-1 rounded-panel border border-line bg-transparent px-3 text-sm" />
            <button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => onOpenConnect?.("MCP")}>Add custom MCP</button>
          </div>
          <ConnectorDirectory query={catalogQuery} choose={onChooseRemote} openProvider={() => onOpenConnect?.("OpenAI")} oauthAction={(name) => {
            const status = oauthByName[name];
            if (!status || isStatusUnavailable(status)) return <button type="button" className="min-h-11 text-accent" disabled={refreshing === name} onClick={() => refreshOne(name)}>Check status</button>;
            if (status.state === "connected") return <button type="button" className="min-h-11 text-accent" onClick={() => openSavedRow(`connection-${OAUTH_BOARD[name].connector}`)}>Review connection</button>;
            if (status.state !== "not_connected") return <span className="text-xs text-muted">{status.detail}</span>;
            return <button type="button" className="min-h-11 font-semibold text-accent" disabled={busy === name} onClick={() => connectOauth(name)}>Connect</button>;
          }} />
          {note && temporaryDraft && <p role="status" className="text-sm text-muted">{note.text}</p>}
          <section className="intelligence-group" aria-label="Connected" data-testid="connected-services">
            <h3>Saved connections</h3>
            <p className="mb-2 text-sm text-muted">{connected.length || savedMcp.length ? "Check each service’s status before using it." : rows.some((r) => unresolved(r.state)) ? "Some connection statuses are pending or unavailable." : "No saved connections yet."}</p>
            <div id="owner-service-board" className="service-board plugin-links">
              {connected.filter(matchesSearch).map((service) => renderService(service))}
              {foundMcp.map((server) => <article key={server.id} className="plugin-link">
                <div className="plugin-link__main"><ServiceMark name="MCP" /><div><p className="font-semibold">{server.label}</p><p className="text-sm text-muted">{server.state} · {server.tools.length} supported tools</p></div></div>
                <button className="min-h-11 text-accent" onClick={() => openSavedRow("connection-" + server.id)}>Review tools</button>
              </article>)}
            </div>
          </section>
          <section className="intelligence-group" aria-label="Model providers">
            <h3>Model providers</h3>
            {matchesSearch(grok) && <p className="text-sm">{grok.name} · {grok.state}</p>}
            {foundProviders.map((provider) => <article key={provider.id} className="plugin-link">
              <div><p className="font-semibold">{provider.label}</p><p className="text-sm text-muted">{provider.hasKey ? "Key saved" : "Key missing"} · {provider.defaultModel || "No model selected"} · {provider.status}</p></div>
              <button className="min-h-11 text-accent" onClick={() => openSavedRow("provider-" + provider.id)}>Manage provider</button>
            </article>)}
            <button className="min-h-11 text-accent" onClick={() => openSavedRow("owner-api-connect")}>Add model provider</button>
          </section>
          {checking.length > 0 && <section className="intelligence-group" aria-label="Connection status"><h3>Connection checks and recovery</h3><div className="service-board plugin-links">{checking.map(renderService)}</div></section>}
          <section className="intelligence-group" aria-label="Build links" data-testid="kimi-connection">
            <h3>Build links</h3>
            <KimiDeviceConnect />
          </section>
          <section className="intelligence-group" aria-label="Not connected">
            <h3>Not connected</h3>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" aria-expanded={showWaiting} onClick={() => setShowWaiting((open) => !open)}>
              {showWaiting ? "Hide services that are not connected" : `Show ${waiting.length} services that are not connected`}
            </button>
            {showWaiting || needle ? (
              <div className="mt-3 space-y-3">

                {bands.length === 0 && !connected.some(matchesSearch) && !checking.length && !foundProviders.length && !foundMcp.length && !matchesSearch(grok) ? <p className="text-sm text-muted">No saved or built-in service matches that search.</p> : bands.map((band) => (
                  <details key={band.label} className="rounded-panel border border-line p-3" open={needle.length > 0}>
                    <summary className="cursor-pointer text-sm font-semibold">{band.label}</summary>
                    <div className="service-board plugin-links mt-3">{band.items.map((service) => renderService(service))}</div>
                  </details>
                ))}
              </div>
            ) : null}
          </section>
        </>
      );
    })()}
    </div>
  );

  function catalogBand(name: string) {
    if (name === "Gmail" || name === "Slack") return "Communication";
    if (name === "Notion" || name === "Google Drive" || name === "Google Docs" || name === "Google Calendar") return "Productivity";
    if (name === "GitHub" || name === "Vercel" || name === "Local computer") return "Developer";
    if (name === "Grok" || name === "OpenAI" || name === "Claude" || name === "Gemini" || name === "OpenRouter" || name === "Nemotron" || name === "Local model") return "Models";
    if (name === "YouTube" || name === "Web search" || name === "Image and video") return "Research and media";
    if (name === "MCP") return "Custom MCP";
    return "Other";
  }

  function renderService(service: Service) {
        const meta = OAUTH_BOARD[service.name];
        const oauth = meta ? oauthByName[service.name] : undefined;
        const unavailable = Boolean(oauth && isStatusUnavailable(oauth));
        const needsSignIn = Boolean(oauth && /sign in required/i.test(oauth.detail));
        const slackOff = service.name === "Slack";
        const oauthConnected = Boolean(meta && oauth?.state === "connected");
        const showOauthConnect = Boolean(meta && oauth?.state === "not_connected" && !unavailable);
        const showNotConfigured = Boolean(meta && oauth?.state === "not_configured");
        const isBusy = busy === service.name;
        return (
          <article ref={focusConnection} tabIndex={-1} id={meta ? `connection-${meta.connector}` : undefined} key={service.name} className="plugin-link">
            <div className="plugin-link__main">
              <ServiceMark name={service.name} />
              <div>
                <p className="font-semibold">{service.name}</p>
                <p className="text-sm text-muted">{slackOff ? "Slack stays off. No Slack login is started." : needsSignIn ? "Sign in before this app can check this connection." : service.detail}</p>
              </div>
            </div>
            <span className="plugin-link__state">{slackOff ? "Off" : needsSignIn ? "Sign in required" : service.state}</span>
            <div className="plugin-link__action">
            {service.name === "Google Docs" ? <span className="text-xs text-muted">Setup unavailable</span> : slackOff ? null : needsSignIn ? (
              <button type="button" className="min-h-11 rounded-panel bg-accent px-3 text-sm font-semibold text-accent-ink" onClick={() => window.location.assign("/login")}>
                Sign in
              </button>
            ) : unavailable && oauth ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-3 text-sm text-danger"
                  data-testid="connector-status-retry"
                  disabled={refreshing === service.name}
                  onClick={() => refreshOne(service.name)}
                >
                  Retry
                </button>
            ) : meta && oauthConnected ? (
              <>
              {(oauth?.authorization === "expired" || oauth?.recovery?.status === "reconnect_required") && <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void connectOauth(service.name)}>Reconnect</button>}
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void disconnectOauth(service.name)}>
                Disconnect
              </button>
              </>
            ) : meta && showOauthConnect ? (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void connectOauth(service.name)}>
                Connect
              </button>
            ) : meta && showNotConfigured ? (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => explainOrOpen(service.name, service.detail)}>
                Setup
              </button>

            ) : (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => explainOrOpen(service.name, service.detail)}>
                {service.name === "Grok" && grokConfigured ? "How it works" : "Setup"}
              </button>
            )}
            </div>
            {oauthConnected && oauth && !slackOff && <details className="plugin-link__extra text-xs text-muted">
              <summary className="min-h-8 cursor-pointer py-2">Authorization details</summary>
              <p>{oauth.scopeEvidence === "provider" ? "Permissions reported by the provider" : oauth.scopeEvidence === "requested" ? "Permissions requested during connection; the provider did not report the granted list" : "Recorded permissions; grant evidence was not recorded for this older connection"}. Each action still checks resource access and owner approval.</p>
              {oauth.scopes?.length ? <ul className="mt-2 space-y-1">{oauth.scopes.map((scope) => <li key={scope} className="break-all">{scope}</li>)}</ul> : <p className="mt-2">No permission list was supplied. Saved authorization does not prove read or write access.</p>}
              {oauth.workspaceId && <p className="mt-2 break-all">Workspace: {oauth.workspaceName || oauth.workspaceId}</p>}
              {oauth.expiresAt && <p className="mt-2">Access token expiry: {new Date(oauth.expiresAt).toLocaleString()}</p>}
            </details>}
            {service.name === "Notion" && oauth && (oauthConnected || showOauthConnect) &&
              <NotionWorkspaces key={oauth.connectedAt || oauth.state} onAdd={() => connectOauth("Notion")} onRepair={(returnTo) => connectOauth("Notion", returnTo)} onSelect={() => refreshOne("Notion")} />}
            {service.name === "MCP" ? (
              <div className="plugin-link__extra">
                <button
                  type="button"
                  className="min-h-11 rounded-panel border border-line px-3 text-left text-sm disabled:opacity-50"
                  data-testid="mcp-storage-check"
                  disabled={mcpStorage?.state === "checking"}
                  onClick={verifyMcpStorage}
                >
                  Check MCP storage
                </button>
                {mcpStorage ? (
                  <p className="break-words text-xs text-muted" role="status" data-testid="mcp-storage-check-result">
                    {mcpStorage.detail}
                  </p>
                ) : (
                  <p className="break-words text-xs text-muted">This checks your database and migrations, not external MCP tool execution.</p>
                )}
              </div>
            ) : null}
            {oauthActionState.status === "error" && oauthActionState.params.name === service.name ? (
              <OauthBoardActionStatusRows
                state={oauthActionState}
                onRetry={
                  onceRetry(() =>
                    runOauthAction(snapshotOauthBoardActionParams(oauthActionState.params)),
                  ) ?? (() => undefined)
                }
              />
            ) : note && note.name === service.name ? (
              <p className="mt-2 text-xs text-muted">{note.text}</p>
            ) : null}
          </article>
        );
  }
}
