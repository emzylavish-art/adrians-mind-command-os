import { CONNECTOR_DISPLAY_NAMES, isConnectorId, type ConnectorId } from "./store.ts";

/** Escape text for HTML element / attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CALLBACK_SECURITY_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

/** Map provider error codes to fixed copy — never reflect raw query input. */
export function oauthProviderErrorMessage(connectorLabel: string, _errorCode: string | null): string {
  const code = (_errorCode || "").toLowerCase();
  if (code === "access_denied") {
    return `${connectorLabel} access was denied. Nothing was stored.`;
  }
  if (code === "invalid_scope") {
    return `${connectorLabel} rejected the requested scopes. Nothing was stored.`;
  }
  return `${connectorLabel} returned an OAuth error. Nothing was stored.`;
}

export function oauthCallbackHtml(input: {
  connector: string;
  message: string;
  ok: boolean;
}): Response {
  const known = isConnectorId(input.connector) ? (input.connector as ConnectorId) : null;
  const name = known ? CONNECTOR_DISPLAY_NAMES[known] : "Connector";
  const title = input.ok ? `${name} connected` : `${name} connect failed`;
  const messageType = known ? `${known}-oauth` : "oauth";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(input.message);
  const safeTypeJson = JSON.stringify(messageType);
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body style="font-family:system-ui;padding:2rem"><h1>${safeTitle}</h1><p>${safeMessage}</p><p><a id="oauth-return" href="/">Back to app</a></p><script>try{window.opener&&window.opener.postMessage({type:${safeTypeJson},ok:${input.ok}},window.location.origin)}catch(e){};try{const k="mind.oauth.return."+${JSON.stringify(known || "")};const saved=JSON.parse(sessionStorage.getItem(k)||"null");sessionStorage.removeItem(k);if(saved&&saved.state===new URLSearchParams(location.search).get("state")&&typeof saved.path==="string"&&saved.path.startsWith("/?")&&new URL(saved.path,location.origin).origin===location.origin&&new URL(saved.path,location.origin).pathname==="/"){document.getElementById("oauth-return").setAttribute("href",saved.path);document.getElementById("oauth-return").textContent="Return to your task — review before writing";}}catch(e){}</script></body></html>`;
  return new Response(body, {
    status: input.ok ? 200 : 400,
    headers: CALLBACK_SECURITY_HEADERS,
  });
}
