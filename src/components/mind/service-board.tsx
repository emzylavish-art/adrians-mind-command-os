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
  { name: "OpenRouter", state: "Not configured", detail: "No API key." },
  { name: "Web search", state: "Not configured", detail: "No search endpoint. No citations are created." },
  { name: "Image and video", state: "Not called", detail: "Paid generation is not run from this app." },
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
  const [selected, setSelected] = useState("Grok");
  const [mcpStorage, setMcpStorage] = useState<{ state: "checking" | "ready" | "error"; detail: string } | null>(null);
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
    <>
    <div id="owner-service-board" className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="flex gap-1 overflow-auto lg:flex-col" role="tablist" aria-label="Connections">
        {[grok, ...services].map((service) => (
          <button key={service.name} type="button" role="tab" aria-selected={selected === service.name} onClick={() => setSelected(service.name)} className={"flex min-h-11 min-w-40 items-center justify-between gap-2 rounded-panel border px-3 text-left text-sm " + (selected === service.name ? "border-accent bg-surface" : "border-line")}>
            <span className="font-semibold">{service.name}</span>
            <span className="max-w-24 truncate text-xs text-muted">{service.state}</span>
          </button>
        ))}
      </div>
      <div>
      {[grok, ...services].filter((service) => service.name === selected).map((service) => {
        const meta = OAUTH_BOARD[service.name];
        const oauth = meta ? oauthByName[service.name] : undefined;
        const unavailable = Boolean(oauth && isStatusUnavailable(oauth));
        const oauthConnected = Boolean(meta && oauth?.state === "connected");
        const legacyConnected = service.name === "Notion" && !oauthConnected && notion?.state === "connected";
        const showOauthConnect = Boolean(meta && oauth?.state === "not_connected" && !unavailable);
        const showNotConfigured = Boolean(meta && oauth?.state === "not_configured");
        const isBusy = busy === service.name;
        return (
          <article key={service.name} className="dense-card card-texture min-w-0 overflow-hidden p-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 break-words font-semibold">{service.name}</h3>
              <span className="max-w-full break-words rounded-full border border-line px-2 py-0.5 text-xs text-muted">{service.state}</span>
            </div>
            {unavailable ? null : <p className="mt-2 break-words text-sm text-muted">{service.detail}</p>}
            {unavailable && oauth ? (
              <div
                className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-3 py-2"
                role="alert"
                data-testid="connector-status-unavailable"
              >
                <p className="text-sm text-danger">{oauth.detail}</p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-3 text-sm text-danger"
                  data-testid="connector-status-retry"
                  disabled={refreshing === service.name}
                  onClick={() => refreshOne(service.name)}
                >
                  Retry
                </button>
              </div>
            ) : meta && oauthConnected ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void disconnectOauth(service.name)}>
                Disconnect
              </button>
            ) : meta && showOauthConnect ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" disabled={isBusy} onClick={() => void connectOauth(service.name)}>
                Connect
              </button>
            ) : meta && showNotConfigured ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => explainOrOpen(service.name, service.detail)}>
                Setup
              </button>
            ) : legacyConnected && onDisconnect ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onDisconnect}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => explainOrOpen(service.name, service.detail)}>
                {service.name === "Grok" && grokConfigured ? "How it works" : "Setup"}
              </button>
            )}
            {service.name === "MCP" ? (
              <div className="mt-3 grid min-w-0 gap-2">
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
      })}

      </div>
    </div>
    <KimiDeviceConnect />
    </>
  );
}
