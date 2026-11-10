/** Safe user-initiated diagnostics for owner-scoped MCP storage.
 * This is NOT an MCP handshake or proof an external server works.
 */
export type McpStorageCheck = {
  state: "ready" | "error";
  code: string;
  detail: string;
};
export async function checkMcpStorage(
  options: { fetchImpl?: typeof fetch; bearerToken?: string | null } = {},
): Promise<McpStorageCheck> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.bearerToken) headers.authorization = "Bearer " + options.bearerToken;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)("/api/mind/mcp/servers?view=health", {
      credentials: "same-origin", method: "GET", cache: "no-store",
      headers, signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { state: "error", code: "network_failure", detail: "The MCP storage check could not reach the server." };
  }
  let data: unknown;
  try {
    const text = await response.text();
    if (text.length > 30_000) throw new Error("oversized");
    data = JSON.parse(text);
  } catch {
    return { state: "error", code: "invalid_response", detail: "The MCP storage check returned an unreadable response." };
  }
  const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (response.status === 401) return { state: "error", code: "sign_in_required", detail: "Sign in to check your MCP storage." };
  if (response.status === 403) return { state: "error", code: "forbidden", detail: "Your session was not authorised to check MCP storage." };
  if (response.ok && body.ok === true && body.code === "ready") {
    const rows = typeof body.savedRegistryRows === "number" && Number.isFinite(body.savedRegistryRows)
      ? body.savedRegistryRows : 0;
    return { state: "ready", code: "ready", detail: "MCP storage and required migrations are reachable. " +
      rows + " saved registry row(s). Remote MCP servers have not been tested." };
  }
  if (body.code === "migrations_pending" && body.migrations &&
      typeof body.migrations === "object" && !Array.isArray(body.migrations)) {
    const missing = Object.entries(body.migrations as Record<string, unknown>)
      .filter(([_, present]) => present === false).map(([name]) => name);
    return { state: "error", code: "migrations_pending",
      detail: missing.length ? "Database migrations missing: " + missing.join(", ") : "Database migrations are not confirmed." };
  }
  const code = typeof body.code === "string" && /^[a-z_]{1,50}$/.test(body.code)
    ? body.code : "unavailable";
  const known: Record<string, string> = {
    database_not_configured: "The persistent application database is not configured.",
    migration_table_unavailable: "Migration records could not be read.",
    registry_table_unavailable: "The MCP registry table could not be queried.",
  };
  return { state: "error", code, detail: known[code] ?? "MCP storage check failed (HTTP " + response.status + ")." };
}
