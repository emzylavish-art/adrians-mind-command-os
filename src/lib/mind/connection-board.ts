/**
 * Service board status from the OAuth /status payload.
 * An OAuth not_connected result is the connection state. A legacy API-token
 * "connected" flag must not paint over it.
 */

export type BoardOauth = { state: string; detail: string; authorization?: string; recovery?: { status: string } } | null | undefined;
export type BoardLegacy = { state: string; detail: string } | null | undefined;

export function oauthBoardState(oauth: BoardOauth, legacy?: BoardLegacy): { state: string; detail: string } {
  if (oauth === undefined) return { state: "Checking", detail: "Checking connection…" };
  if (oauth === null) return { state: "Status unavailable", detail: "Connection status could not be read." };
  if (oauth.state === "unavailable" || /status could not be read/i.test(oauth.detail)) {
    return { state: "Status unavailable", detail: oauth.detail || "Connection status could not be read." };
  }
  if (oauth.recovery?.status === "reconnect_required" || oauth.authorization === "expired") return { state: "Needs attention", detail: oauth.detail };
  if (oauth.recovery?.status === "revocation_unknown") return { state: oauth.state === "connected" ? "Authorization saved · review access" : "Disconnected · review access", detail: oauth.detail };
  if (oauth.state === "connected") return { state: "Authorization saved", detail: oauth.detail };
  if (oauth.state === "not_configured") {
    if (legacy?.state === "connected") {
      return { state: "API token present", detail: `${legacy.detail} This is not an OAuth session.` };
    }
    return { state: "Not configured", detail: oauth.detail };
  }
 if (oauth.state === "not_connected") return { state: "Not connected", detail: oauth.detail };
  if (legacy?.state === "connected") {
    return { state: "API token present", detail: `${legacy.detail} This is not an OAuth session.` };
  }
  if (legacy?.state === "disconnected") return { state: "Disconnected", detail: legacy.detail };
  if (legacy) return { state: "Not connected", detail: legacy.detail };
  return { state: "Not connected", detail: oauth.detail || "Not connected." };
}

export type OwnerConnectTarget = "api" | "mcp" | "notion";

/** Cards whose Setup button must open a real paste form, not only a sentence. */
export function ownerConnectTarget(name: string): OwnerConnectTarget | null {
  if (name === "OpenAI" || name === "Claude" || name === "Gemini" || name === "OpenRouter") return "api";
  if (name === "MCP") return "mcp";
  if (name === "Notion") return "notion";
  return null;
}

export function ownerApiKind(name: string): "openai" | "anthropic" | "gemini" | "openrouter" | null {
  if (name === "OpenAI") return "openai";
  if (name === "Claude") return "anthropic";
  if (name === "Gemini") return "gemini";
  if (name === "OpenRouter") return "openrouter";
  return null;
}
