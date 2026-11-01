import { useCallback, useEffect, useRef, useState } from "react";
import {
  OAUTH_STATUS_FETCH_TIMEOUT_MS,
  fetchOauthStatusPayload,
  isStatusUnavailable,
  type OauthStatusPayload,
} from "@/lib/mind/service-board-status";

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
  { name: "Slack", state: "Not connected", detail: "Slack is not configured." },
  { name: "OpenAI", state: "Not configured", detail: "No API key. A chat subscription is not used." },
  { name: "Claude", state: "Not configured", detail: "No API key. Nothing is sent to Anthropic." },
  { name: "Gemini", state: "Not configured", detail: "No API key. Nothing is sent to Google." },
  { name: "OpenRouter", state: "Not configured", detail: "No API key." },
  { name: "Web search", state: "Not configured", detail: "No search endpoint. No citations are created." },
  { name: "Image and video", state: "Not called", detail: "Paid generation is not run from this app." },
  { name: "Voice", state: "Not realtime", detail: "Browser speech when this browser has it. Not a live call." },
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
  Slack: { connector: "slack", path: "slack", messageType: "slack-oauth" },
  GitHub: { connector: "github", path: "github", messageType: "github-oauth" },
};

function boardState(oauth: OauthStatus | null, legacy?: { state: string; detail: string } | null): { state: string; detail: string } {
  if (oauth && isStatusUnavailable(oauth)) {
    return { state: "Status unavailable", detail: oauth.detail };
  }
  if (oauth?.state === "connected") {
    return { state: "Connected", detail: oauth.detail };
  }
  if (oauth?.state === "not_configured") {
    return { state: "Not configured", detail: oauth.detail };
  }
  if (oauth?.state === "not_connected") {
    if (legacy?.state === "connected") {
      return { state: "Connected", detail: legacy.detail };
    }
    return { state: "Not connected", detail: oauth.detail };
  }
  if (legacy) {
    return {
      state: legacy.state === "connected" ? "Connected" : legacy.state === "disconnected" ? "Disconnected" : "Not connected",
      detail: legacy.detail,
    };
  }
  return { state: "Not connected", detail: "Checking connection…" };
}

function boardForOauth(name: string, oauth: OauthStatus | null | undefined, legacy?: { state: string; detail: string } | null) {
  void name;
  if (oauth === undefined) {
    return { state: "Not connected", detail: "Checking connection…" };
  }
  return boardState(oauth, legacy);
}


export function ServiceBoard({
  grokConfigured,
  onSetup,
  notion,
  mcp,
  localComputer,
  onDisconnect,
}: {
  grokConfigured: boolean;
  onSetup: (message: string) => void;
  notion?: { state: string; detail: string } | null;
  mcp?: { state: string; detail: string } | null;
  localComputer?: { state: string; detail: string } | null;
  onDisconnect?: () => void;
}) {
  const [oauthByName, setOauthByName] = useState<Record<string, OauthStatus | null | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [note, setNote] = useState<{ name: string; text: string } | null>(null);
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
    ? { name: "Grok", state: "Key present", detail: "Grok 4.5 can answer when you press Send. That is not a live-verified integration." }
    : { name: "Grok", state: "Not configured", detail: "No server key is visible to this page." };

  const services = SERVICES.map((service) => {
    if (service.name === "MCP" && mcp) {
      return { name: "MCP", state: mcp.state, detail: mcp.detail };
    }
    const meta = OAUTH_BOARD[service.name];
    if (!meta) return service;
    const legacy = service.name === "Notion" ? notion : null;
    const board = boardForOauth(service.name, oauthByName[service.name], legacy);
    return { name: service.name, state: board.state, detail: board.detail };
  });

  async function connectOauth(name: string) {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    setBusy(name);
    setNote(null);
    try {
      const res = await fetch(`/api/mind/oauth/${meta.path}/start?format=json`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !body?.ok || !body.url) {
        const message = body?.error || `${name} OAuth could not be started.`;
        setNote({ name, text: message });
        onSetup(message);
        setBusy(null);
        return;
      }
      window.location.assign(body.url);
    } catch {
      const message = `${name} OAuth could not be started. Nothing was connected.`;
      setNote({ name, text: message });
      onSetup(message);
      setBusy(null);
    }
  }

  async function disconnectOauth(name: string) {
    const meta = OAUTH_BOARD[name];
    if (!meta) return;
    setBusy(name);
    setNote(null);
    try {
      const res = await fetch(`/api/mind/oauth/${meta.path}/disconnect`, { method: "POST", credentials: "include" });
      const body = (await res.json().catch(() => null)) as OauthStatus & { ok?: boolean; error?: string } | null;
      if (body?.state) {
        setOauthByName((prev) => ({ ...prev, [name]: { state: body.state, detail: body.detail } }));
        setNote({ name, text: body.detail });
      }
      if (name === "Notion") onDisconnect?.();
      refreshOne(name);
    } catch {
      setNote({ name, text: "Disconnect failed. The board was not changed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {[grok, ...services].map((service) => {
        const meta = OAUTH_BOARD[service.name];
        const oauth = meta ? oauthByName[service.name] : undefined;
        const unavailable = Boolean(oauth && isStatusUnavailable(oauth));
        const oauthConnected = Boolean(meta && oauth?.state === "connected");
        const legacyConnected = service.name === "Notion" && !oauthConnected && notion?.state === "connected";
        const showOauthConnect = Boolean(meta && oauth?.state === "not_connected" && !unavailable);
        const showNotConfigured = Boolean(meta && oauth?.state === "not_configured");
        const isBusy = busy === service.name;
        return (
          <article key={service.name} className="dense-card card-texture p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{service.name}</h3>
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{service.state}</span>
            </div>
            {unavailable ? null : <p className="mt-2 text-sm text-muted">{service.detail}</p>}
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
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onSetup(service.detail)}>
                Setup
              </button>
            ) : legacyConnected && onDisconnect ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onDisconnect}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onSetup(service.detail)}>
                {service.name === "Grok" && grokConfigured ? "How it works" : "Setup"}
              </button>
            )}
            {note && note.name === service.name ? <p className="mt-2 text-xs text-muted">{note.text}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
