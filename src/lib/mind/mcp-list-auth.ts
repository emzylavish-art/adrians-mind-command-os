/**
 * Soft-auth decision for mcpRegistryList (Tools panel).
 * Always prefer the shared getSessionUser result (Supabase HttpOnly cookies,
 * then Better Auth / gate) so signed-in Supabase users never look unauthenticated
 * when Better Auth is off. Dev-only shared user is a last resort.
 */
export type McpListSessionUser = { id: string; email?: string | null } | null;

export type McpRegistryServerRow = {
  id: string;
  label: string;
  kind: string;
  enabled: boolean;
};

export type McpRegistryListPayload =
  | { status: "ok"; servers: McpRegistryServerRow[] }
  | { status: "unauthenticated"; servers: [] };

/**
 * Resolve the owner user id for the MCP list soft-auth path.
 * `sessionUser` must come from getSessionUser (or a test double that mimics it).
 */
export function resolveMcpListUserId(input: {
  sessionUser: McpListSessionUser;
  authConfigured: boolean;
  gateIdentityEnabled: boolean;
  databaseConfigured: boolean;
  devUserId: string;
}): string | null {
  const fromSession = input.sessionUser?.id?.trim() || "";
  if (fromSession) return fromSession;
  // Match requireUserId auth-off path: shared dev user only without a real DB.
  if (!input.authConfigured && !input.gateIdentityEnabled && !input.databaseConfigured) {
    return input.devUserId;
  }
  return null;
}

/** Build the soft-auth payload the Tools panel expects. */
export function buildMcpRegistryListPayload(
  userId: string | null,
  servers: McpRegistryServerRow[],
): McpRegistryListPayload {
  if (!userId) {
    return { status: "unauthenticated", servers: [] };
  }
  return { status: "ok", servers };
}
