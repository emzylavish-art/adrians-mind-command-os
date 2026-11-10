/**
 * A single, read-only fallback when a TanStack MCP list server-function
 * transport fails (including browser-side server function network errors).
 * The REST route authenticates the same owner and never returns credentials.
 *
 * Never use this helper for tool calls or mutations. It does not turn a
 * permission denial into a second request.
 */
export type McpListView = "registry" | "saved";

export async function loadMcpWithHttpFallback(
  primary: () => Promise<unknown>,
  view: McpListView,
  options: {
    fetchImpl?: typeof fetch;
    bearerToken?: string | null;
  } = {},
): Promise<unknown> {
  try {
    return await primary();
  } catch (originalError) {
    const status = typeof originalError === "object" && originalError !== null &&
      "status" in originalError ? Number((originalError as { status: unknown }).status) : 0;
    // Auth and origin failures must be handled as auth failures; never
    // conceal them or send a second request.
    if (status === 401 || status === 403) throw originalError;
    const transport = options.fetchImpl ??
      (typeof window !== "undefined" ? fetch : undefined);
    if (!transport) throw originalError;

    const path = view === "saved" ? "/api/mind/mcp/servers?view=saved" : "/api/mind/mcp/servers";
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.bearerToken) headers.authorization = "Bearer " + options.bearerToken;

    let response: Response;
    try {
      response = await transport(path, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers,
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      // Preserve a genuine upstream transport error, rather than inventing an
      // empty MCP list or claiming that the fallback succeeded.
      throw originalError;
    }
    if (!response.ok) {
      const statusError = Object.assign(
        new Error(response.status === 401 ? "Sign in is required." :
          response.status === 403 ? "Forbidden: cross-site request blocked" :
          "The MCP server list could not be loaded (HTTP " + response.status + ")."),
        { status: response.status },
      );
      throw statusError;
    }
    const raw = await response.text();
    if (raw.length > 250_000) throw new Error("MCP server list was too large.");
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch {
      throw new SyntaxError("The MCP server list response was not valid JSON.");
    }
    if (!payload || typeof payload !== "object" || !("servers" in payload) ||
        !Array.isArray((payload as { servers: unknown }).servers)) {
      throw new Error("MCP server list was missing its servers array.");
    }
    return payload;
  }
}
