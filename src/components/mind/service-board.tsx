import { useCallback, useEffect, useRef, useState } from "react";
import { getBearerToken } from "@/lib/auth/client";
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
  const marks: Record<string, { bg: string; fg: string; letter: string }> = {
    Gmail: { bg: "#EA4335", fg: "#fff", letter: "M" },
    "Google Calendar": { bg: "#4285F4", fg: "#fff", letter: "31" },
    "Google Drive": { bg: "#0F9D58", fg: "#fff", letter: "D" },
    "Google Docs": { bg: "#4285F4", fg: "#fff", letter: "W" },
    YouTube: { bg: "#FF0033", fg: "#fff", letter: "▶" },
    GitHub: { bg: "#f4f4f5", fg: "#111", letter: "GH" },
    Notion: { bg: "#f4f4f5", fg: "#111", letter: "N" },
    Slack: { bg: "#4A154B", fg: "#fff", letter: "#" },
    Grok: { bg: "#111", fg: "#fff", letter: "G" },
    OpenAI: { bg: "#10a37f", fg: "#fff", letter: "AI" },
    Claude: { bg: "#d97757", fg: "#fff", letter: "C" },
    Gemini: { bg: "#8ab4f8", fg: "#111", letter: "Ge" },
    Voice: { bg: "#2f6bff", fg: "#fff", letter: "♪" },
  };
  const mark = marks[name] ?? { bg: "#27272a", fg: "#fff", letter: name.slice(0, 1) };
  const file = files[name];
  const tile = name === "OpenAI" || name === "GitHub" || name === "MCP";
  if (file) return <img className={tile ? "service-mark on-tile" : "service-mark"} src={file} alt="" width={28} height={28} />;
  return <span className="service-mark" style={{ background: mark.bg, color: mark.fg }} aria-hidden="true">{mark.letter}</span>;
}

const SERVICES: Service[] = [
  { name: "Notion", state: "Not connected", detail: "No Notion OAuth. Nothing can be searched or updated." },
  { name: "GitHub", state: "Not connected", detail: "No repository connection. Nothing can be pushed." },
  { name: "Gmail", state: "Not connected", detail: "No mailbox is connected. Nothing is read or sent." },
  { name: "Google Drive", state: "Not connected", detail: "No Drive connection. No files are listed." },
  { name: "Google Docs", state: "Not connected", detail: "No Docs connection." },
  { name: "Google Calendar", state: "Not connected", detail: "No Calendar connection." },
  { name: "YouTube", state: "Not connected", detail: "No YouTube connection." },
  { name: "Slack", state: "Not connected", detail: "Slack is not configured." },
  { name: "OpenAI", state: "Not configured", detail: "No API key. A chat subscription is not used." },
  { name: "Claude", state: "Not configured", detail: "No API key. Nothing is sent to Anthropic." },
  { name: "Gemini", state: "Not configured", detail: "No API key. Nothing is sent to Google." },
  { name: "OpenRouter", state: "Selectable", detail: "Shown in Controls, bots, and the orchestrator. It sends only when a key is connected. Grok is not substituted." },
  { name: "Nemotron", state: "Selectable", detail: "Free OpenRouter model. It appears in Controls, bots, and the orchestrator. It sends only when OpenRouter is connected." },
  { name: "Local model", state: "Selectable", detail: "Appears in Controls, bots, and the orchestrator. It sends only when a local runner answers. Grok is not substituted." },
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
};

function boardForOauth(name: string, oauth: OauthStatus | null | undefined, legacy?: { state: string; detail: string } | null) {
  void name;
  return oauthBoardState(oauth, legacy);
}


export function ServiceBoard({
  grokConfigured,
  onSetup,
  notion,
  mcp,
  localComputer,
  onDisconnect,
  onFailure,
  onOpenConnect,
}: {
  grokConfigured: boolean;
  onSetup: (message: string) => void;
  notion?: { state: string; detail: string } | null;
  mcp?: { state: string; detail: string } | null;
  localComputer?: { state: string; detail: string } | null;
  onDisconnect?: () => void;
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
  /** Opens the paste form for a card. Setup must not only repeat a sentence. */
  onOpenConnect?: (name: string) => void;
}) {
  const [oauthByName, setOauthByName] = useState<Record<string, OauthStatus | null | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [note, setNote] = useState<{ name: string; text: string } | null>(null);
  const [oauthActionState, setOauthActionState] = useState<OauthBoardActionState>({ status: "idle" });
  const [mcpStorage, setMcpStorage] = useState<{ state: "checking" | "ready" | "error"; detail: string } | null>(null);
  const [showWaiting, setShowWaiting] = useState(true);
  const [catalogQuery, setCatalogQuery] = useState("");
  const inFlight = useRef<Set<string>>(new Set());

  const refreshOne = useCallback((name: string) => {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    if (inFlight.current.has(name)) return;
    inFlight.current.add(name);
    setRefreshing(name);
    // Always resolves: 401/403/5xx, network, non-JSON, and a hung probe become a terminal unavailable status.
    void fetchOauthStatusPayload(`/api/mind/oauth/${meta.path}/status`, {
      timeoutMs: OAUTH_STATUS_FETCH_TIMEOUT_MS,
    })
      .then((status) => {
        setOauthByName((prev) => ({ ...prev, [name]: status }));
      })
      .finally(() => {
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
      if (!event.data || typeof event.data !== "object") return;
      const type = (event.data as { type?: string }).type;
      if (!type) return;
      for (const [name, meta] of Object.entries(OAUTH_BOARD)) {
        if (type === meta.messageType) refreshOne(name);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refreshAll, refreshOne]);

  const grok: Service = grokConfigured
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
    const legacy = service.name === "Notion" ? notion : null;
    const board = boardForOauth(service.name, oauthByName[service.name], legacy);
    return { name: service.name, state: board.state, detail: board.detail };
  });

  function runOauthAction(params: ReturnType<typeof snapshotOauthBoardActionParams>) {
    setBusy(params.name);
    setNote(null);
    setOauthActionState({ status: "running", action: params.action, name: params.name });
    const run = () => {
      setBusy(params.name);
      setOauthActionState({ status: "running", action: params.action, name: params.name });
      void runOauthBoardAction(params, fetch).then((result) => {
        if (result.ok) {
          setOauthActionState({ status: "ok", note: result.note, name: result.name, redirectUrl: result.redirectUrl });
          if (params.action === "connect" && result.redirectUrl) {
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

  function connectOauth(name: string) {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    runOauthAction(snapshotOauthBoardActionParams({ action: "connect", name, path: meta.path }));
  }

  function disconnectOauth(name: string) {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    runOauthAction(snapshotOauthBoardActionParams({ action: "disconnect", name, path: meta.path }));
  }

  function explainOrOpen(name: string, detail: string) {
    onOpenConnect?.(name);
    onSetup(detail);
  }

  return (
    <div className="intelligence-main" data-testid="plugins-pane">
    {(() => {
      const readyState = (state: string) => state === "Key present" || state === "Connected" || state === "API token present";
      const rows = [grok, ...services];
      const connected = rows.filter((service) => readyState(service.state));
      const waiting = rows.filter((service) => !readyState(service.state));
      const needle = catalogQuery.trim().toLowerCase();
      const catalog = waiting.filter((service) => !needle || `${service.name} ${service.detail}`.toLowerCase().includes(needle));
      const bands = ["Communication", "Productivity", "Developer", "Models", "Research and media", "Custom MCP", "Other"]
        .map((label) => ({ label, items: catalog.filter((service) => catalogBand(service.name) === label) }))
        .filter((band) => band.items.length > 0);
      return (
        <>
          <section className="intelligence-group" aria-label="Connected" data-testid="connected-services">
            <h3>Connected</h3>
            <p className="mb-2 text-sm text-muted">Grok and Voice stay here. A connection is removed only when you press Disconnect.</p>
            <div id="owner-service-board" className="service-board plugin-links">
              {connected.map((service) => renderService(service))}
            </div>
          </section>
          <section className="intelligence-group" aria-label="Build links" data-testid="kimi-connection">
            <h3>Build links</h3>
            <p className="mb-2 text-sm text-muted">These are the working plugin links. Adding one does not remove Grok or Voice.</p>
            <KimiDeviceConnect />
          </section>
          <section className="intelligence-group" aria-label="Not connected">
            <h3>Not connected</h3>
            <p className="mb-2 text-sm text-muted">These stay hidden until you ask. Custom MCP is added in Build links, not mixed into the other groups.</p>
            <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => setShowWaiting((open) => !open)}>
              {showWaiting ? "Hide services that are not connected" : `Show ${waiting.length} services that are not connected`}
            </button>
            {showWaiting ? (
              <div className="mt-3 space-y-3">
                <input aria-label="Search plugins" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search plugins" className="min-h-11 w-full rounded-panel border border-line bg-transparent px-3 text-sm" />
                {bands.length === 0 ? <p className="text-sm text-muted">No plugin matches that search.</p> : bands.map((band) => (
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
    if (name === "GitHub" || name === "Local computer") return "Developer";
    if (name === "OpenAI" || name === "Claude" || name === "Gemini" || name === "OpenRouter" || name === "Nemotron" || name === "Local model") return "Models";
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
        const legacyConnected = service.name === "Notion" && !oauthConnected && notion?.state === "connected";
        const showOauthConnect = Boolean(meta && oauth?.state === "not_connected" && !unavailable);
        const showNotConfigured = Boolean(meta && oauth?.state === "not_configured");
        const isBusy = busy === service.name;
        return (
          <article key={service.name} className="plugin-link">
            <div className="plugin-link__main">
              <ServiceMark name={service.name} />
              <div>
                <p className="font-semibold">{service.name}</p>
                <p className="text-sm text-muted">{slackOff ? "Slack stays off. No Slack login is started." : needsSignIn ? "Sign in before this app can check this connection." : service.detail}</p>
              </div>
            </div>
            <span className="plugin-link__state">{slackOff ? "Off" : needsSignIn ? "Not connected" : service.state}</span>
            <div className="plugin-link__action">
            {slackOff ? null : needsSignIn ? (
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
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void disconnectOauth(service.name)}>
                Disconnect
              </button>
            ) : meta && showOauthConnect ? (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void connectOauth(service.name)}>
                Connect
              </button>
            ) : meta && showNotConfigured ? (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => explainOrOpen(service.name, service.detail)}>
                Setup
              </button>
            ) : legacyConnected && onDisconnect ? (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onDisconnect}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => explainOrOpen(service.name, service.detail)}>
                {service.name === "Grok" && grokConfigured ? "How it works" : "Setup"}
              </button>
            )}
            </div>
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
