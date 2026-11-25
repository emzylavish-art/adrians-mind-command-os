/**
 * ServiceBoard OAuth status probe helpers.
 * MCP Integration (02b2703) already maps 401/403/5xx/network to an honest
 * "Connection status could not be read" terminal OauthStatus. This module adds
 * the hang timeout, explicit non-JSON handling, and shared copy/constants so
 * Retry + regression tests stay in one place without fighting that shape.
 */

/** Same budget as READINESS_PROBE_TIMEOUT_MS (use-connector-readiness). */
export const OAUTH_STATUS_FETCH_TIMEOUT_MS = 10_000;

export type OauthStatusPayload = {
  state: "connected" | "not_configured" | "not_connected" | "unavailable" | string;
  detail: string;
  workspaceName?: string;
  accountLabel?: string;
  connectedAt?: string;
};

export const STATUS_UNAVAILABLE_DETAIL = "Connection status could not be read.";
export const STATUS_UNAVAILABLE_SIGNIN_DETAIL = "Connection status could not be read (sign in required).";

export function isStatusUnavailable(oauth: OauthStatusPayload | null | undefined): boolean {
  if (!oauth) return false;
  if (oauth.state === "unavailable") return true;
  return /status could not be read/i.test(oauth.detail);
}

export function unavailableStatus(httpStatus?: number): OauthStatusPayload {
  if (httpStatus === 401 || httpStatus === 403) {
    return { state: "unavailable", detail: STATUS_UNAVAILABLE_SIGNIN_DETAIL };
  }
  return { state: "unavailable", detail: STATUS_UNAVAILABLE_DETAIL };
}

export type FetchOauthStatusDeps = {
  fetchFn?: typeof fetch;
  bearer?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/**
 * Fetch one connector /status. Always resolves to a terminal OauthStatusPayload
 * (never throws): success body, not_configured, or unavailable after 401/403/5xx,
 * network rejection, hang/timeout, or non-JSON body.
 */
export async function fetchOauthStatusPayload(
  url: string,
  deps: FetchOauthStatusDeps = {},
): Promise<OauthStatusPayload> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? OAUTH_STATUS_FETCH_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal =
    deps.signal && typeof AbortSignal.any === "function" ? AbortSignal.any([deps.signal, timeout]) : timeout;

  try {
    const res = await fetchFn(url, { credentials: "include", cache: "no-store", signal, ...(deps.bearer ? { headers: { authorization: `Bearer ${deps.bearer}` } } : {}) });
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return unavailableStatus(res.status);
      }
    }
    if (!res.ok || !body || typeof body !== "object") {
      // Our own OAuth status routes return a small fixed, sanitised failure
      // message. Preserve it for an actionable 503 card, but never echo
      // arbitrary upstream exception strings or HTML into the interface.
      if (res.status === 503 && body && typeof body === "object") {
        const failure = body as Record<string, unknown>;
        const detail = failure.detail;
        if (failure.state === "unavailable" && typeof detail === "string" &&
            /^Connection status could not be read \(server unavailable\)\.$/.test(detail)) {
          return { state: "unavailable", detail };
        }
      }
      return unavailableStatus(res.status);
    }
    const record = body as Record<string, unknown>;
    const state = typeof record.state === "string" ? record.state : "";
    if (!state) return unavailableStatus(res.status);
    const detail =
      typeof record.detail === "string" && record.detail.trim() ? record.detail : STATUS_UNAVAILABLE_DETAIL;
    const status: OauthStatusPayload = { state, detail };
    if (typeof record.workspaceName === "string") status.workspaceName = record.workspaceName;
    if (typeof record.accountLabel === "string") status.accountLabel = record.accountLabel;
    if (typeof record.connectedAt === "string") status.connectedAt = record.connectedAt;
    return status;
  } catch {
    return unavailableStatus();
  }
}
