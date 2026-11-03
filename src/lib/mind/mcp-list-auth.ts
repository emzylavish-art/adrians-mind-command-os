/**
 * Soft-auth decision for mcpRegistryList (Tools panel).
 * Always prefer the shared getSessionUser result (Supabase HttpOnly cookies,
 * then Better Auth / gate) so signed-in Supabase users never look unauthenticated
 * when Better Auth is off. Dev-only shared user is a last resort.
 */
import type { DecideFetchSiteInput } from "./request-guard.ts";
import { decideFetchSite } from "./request-guard.ts";

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

/**
 * Soft-auth Fetch-Metadata gate for mcpRegistryList.
 * - allow: proceed with session
 * - soft_unauth: same-site / missing Origin → quiet unauthenticated (200), not 403
 * - block: real cross-site / foreign Origin → 403
 */
export type SoftAuthMcpListDecision = "allow" | "soft_unauth" | "block";

export function softAuthMcpListDecision(input: DecideFetchSiteInput): SoftAuthMcpListDecision {
  const decision = decideFetchSite(input);
  if (decision === "allow") return "allow";
  const site = input.site;
  const origin = (input.origin ?? "").trim();
  if (!origin || site === "same-site") return "soft_unauth";
  return "block";
}
