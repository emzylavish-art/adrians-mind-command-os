/**
 * Agent/dashboard transport policy: HTTPS only (or localhost HTTP for dev),
 * pinned origin must match the configured dashboard URL.
 */
export function assertPinnedOrigin(input: {
  dashboardUrl: string;
  requestOrigin: string | null;
  allowLocalHttp?: boolean;
}): { ok: true } | { ok: false; error: string } {
  let dash: URL;
  let origin: URL;
  try {
    dash = new URL(input.dashboardUrl);
    origin = new URL(input.requestOrigin || input.dashboardUrl);
  } catch {
    return { ok: false, error: "Invalid dashboard URL or origin." };
  }
  const local =
    dash.hostname === "localhost" || dash.hostname === "127.0.0.1" || dash.hostname === "[::1]";
  if (dash.protocol === "http:" && !(input.allowLocalHttp && local)) {
    return { ok: false, error: "Dashboard URL must use HTTPS (TLS). HTTP is only allowed for localhost." };
  }
  if (dash.protocol !== "https:" && dash.protocol !== "http:") {
    return { ok: false, error: "Unsupported URL scheme." };
  }
  if (origin.origin !== dash.origin) {
    return { ok: false, error: "Origin does not match the pinned dashboard URL (MITM/downgrade blocked)." };
  }
  return { ok: true };
}

export function agentMustUseTls(dashboardUrl: string): { ok: true } | { ok: false; error: string } {
  return assertPinnedOrigin({ dashboardUrl, requestOrigin: dashboardUrl, allowLocalHttp: true });
}
