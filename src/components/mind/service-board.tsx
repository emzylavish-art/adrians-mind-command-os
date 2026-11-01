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
  const grok: Service = grokConfigured
    ? { name: "Grok", state: "Key present", detail: "Grok 4.5 can answer when you press Send. That is not a live-verified integration." }
    : { name: "Grok", state: "Not configured", detail: "No server key is visible to this page." };
  const services = SERVICES.map((service) =>
    service.name === "Notion" && notion
      ? { name: "Notion", state: notion.state === "connected" ? "Connected" : notion.state === "disconnected" ? "Disconnected" : "Not connected", detail: notion.detail }
      : service.name === "MCP" && mcp
        ? { name: "MCP", state: mcp.state, detail: mcp.detail }
        : service.name === "Local computer" && localComputer
          ? { name: "Local computer", state: localComputer.state, detail: localComputer.detail }
          : service,
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {[grok, ...services].map((service) => (
        <article key={service.name} className="rounded-panel border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{service.name}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{service.state}</span>
          </div>
          <p className="mt-2 text-sm text-muted">{service.detail}</p>
          {service.name === "Notion" && notion?.state === "connected" && onDisconnect ? (
            <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            <button type="button" className="mt-3 min-h-11 rounded-panel border border-line px-3 text-sm" onClick={() => onSetup(service.detail)}>
              {service.name === "Grok" && grokConfigured ? "How it works" : "Setup"}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
