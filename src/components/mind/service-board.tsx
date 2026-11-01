import { useCallback, useEffect, useState } from "react";

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

type OauthStatus = {
  state: "connected" | "not_configured" | "not_connected" | string;
  detail: string;
  workspaceName?: string;
  accountLabel?: string;
  connectedAt?: string;
};

function boardState(oauth: OauthStatus | null, legacy?: { state: string; detail: string } | null): { state: string; detail: string } {
  if (oauth?.state === "connected") {
    return { state: "Connected", detail: oauth.detail };
  }
  if (oauth?.state === "not_configured") {
    return { state: "Not connected", detail: oauth.detail };
  }
  if (oauth?.state === "not_connected") {
    // Fall back to legacy integration-token status when OAuth is configured but unused
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
  return { state: "Not connected", detail: "Checking Notion connection…" };
}

export function ServiceBoard({
  grokConfigured,
  onSetup,
  notion,
  mcp,
  onDisconnect,
}: {
  grokConfigured: boolean;
  onSetup: (message: string) => void;
  notion?: { state: string; detail: string } | null;
  mcp?: { state: string; detail: string } | null;
  onDisconnect?: () => void;
}) {
  const [oauth, setOauth] = useState<OauthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refreshOauth = useCallback(() => {
    void fetch("/api/mind/oauth/notion/status", { credentials: "include" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as OauthStatus & { ok?: boolean; error?: string } | null;
        if (!res.ok || !body) {
          setOauth(null);
          return;
        }
        setOauth({
          state: body.state,
          detail: body.detail,
          workspaceName: body.workspaceName,
          accountLabel: body.accountLabel,
          connectedAt: body.connectedAt,
        });
      })
      .catch(() => setOauth(null));
  }, []);

  useEffect(() => {
    refreshOauth();
    const onMsg = (event: MessageEvent) => {
      if (event.data && typeof event.data === "object" && (event.data as { type?: string }).type === "notion-oauth") {
        refreshOauth();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [refreshOauth]);

  const grok: Service = grokConfigured
    ? { name: "Grok", state: "Key present", detail: "Grok 4.5 can answer when you press Send. That is not a live-verified integration." }
    : { name: "Grok", state: "Not configured", detail: "No server key is visible to this page." };

  const notionBoard = boardState(oauth, notion);

  const services = SERVICES.map((service) =>
    service.name === "Notion"
      ? { name: "Notion", state: notionBoard.state, detail: notionBoard.detail }
      : service.name === "MCP" && mcp
        ? { name: "MCP", state: mcp.state, detail: mcp.detail }
        : service,
  );

  async function connectNotion() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/mind/oauth/notion/start?format=json", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !body?.ok || !body.url) {
        const message = body?.error || "Notion OAuth could not be started.";
        setNote(message);
        onSetup(message);
        setBusy(false);
        return;
      }
      window.location.assign(body.url);
    } catch {
      const message = "Notion OAuth could not be started. Nothing was connected.";
      setNote(message);
      onSetup(message);
      setBusy(false);
    }
  }

  async function disconnectNotionOauth() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/mind/oauth/notion/disconnect", { method: "POST", credentials: "include" });
      const body = (await res.json().catch(() => null)) as OauthStatus & { ok?: boolean; error?: string } | null;
      if (body?.state) {
        setOauth({ state: body.state, detail: body.detail });
        setNote(body.detail);
      }
      onDisconnect?.();
      refreshOauth();
    } catch {
      setNote("Disconnect failed. The board was not changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {[grok, ...services].map((service) => {
        const isNotion = service.name === "Notion";
        const oauthConnected = isNotion && oauth?.state === "connected";
        const legacyConnected = isNotion && !oauthConnected && notion?.state === "connected";
        const showOauthConnect = isNotion && oauth?.state === "not_connected";
        const showNotConfigured = isNotion && oauth?.state === "not_configured";
        return (
          <article key={service.name} className="rounded-panel border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{service.name}</h3>
              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{service.state}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{service.detail}</p>
            {isNotion && oauthConnected ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy} onClick={() => void disconnectNotionOauth()}>
                Disconnect
              </button>
            ) : isNotion && showOauthConnect ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" disabled={busy} onClick={() => void connectNotion()}>
                Connect
              </button>
            ) : isNotion && showNotConfigured ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onSetup(service.detail)}>
                Setup
              </button>
            ) : isNotion && legacyConnected && onDisconnect ? (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onDisconnect}>
                Disconnect
              </button>
            ) : (
              <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onSetup(service.detail)}>
                {service.name === "Grok" && grokConfigured ? "How it works" : "Setup"}
              </button>
            )}
            {isNotion && note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
          </article>
        );
      })}
    </div>
  );
}
