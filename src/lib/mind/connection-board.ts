/**
 * Service board status from the OAuth /status payload.
 * An OAuth not_connected result is the connection state. A legacy API-token
 * "connected" flag must not paint over it.
 */

export type BoardOauth = { state: string; detail: string } | null | undefined;
export type BoardLegacy = { state: string; detail: string } | null | undefined;

export function oauthBoardState(oauth: BoardOauth, legacy?: BoardLegacy): { state: string; detail: string } {
  if (oauth === undefined) return { state: "Checking", detail: "Checking connection…" };
  if (oauth === null) return { state: "Status unavailable", detail: "Connection status could not be read." };
  if (oauth.state === "unavailable" || /status could not be read/i.test(oauth.detail)) {
    return { state: "Status unavailable", detail: oauth.detail || "Connection status could not be read." };
  }
  if (oauth.state === "connected") return { state: "Connected", detail: oauth.detail };
  if (oauth.state === "not_configured") return { state: "Not configured", detail: oauth.detail };
  if (oauth.state === "not_connected") return { state: "Not connected", detail: oauth.detail };
  if (legacy?.state === "connected") {
    return { state: "API token present", detail: `${legacy.detail} This is not an OAuth session.` };
  }
  if (legacy?.state === "disconnected") return { state: "Disconnected", detail: legacy.detail };
  if (legacy) return { state: "Not connected", detail: legacy.detail };
  return { state: "Not connected", detail: oauth.detail || "Not connected." };
}
