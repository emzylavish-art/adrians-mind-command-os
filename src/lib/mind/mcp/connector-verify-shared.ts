/**
 * Client-safe connector verify types + display helpers (no Node/fs imports).
 */
export type ConnectorKind = "mcp" | "oauth";

export type ConnectorVerifyStateName =
  | "not_connected"
  | "ok"
  | "auth_expired"
  | "timeout"
  | "error";

export type ConnectorVerifyResult = {
  id: string;
  kind: ConnectorKind;
  label: string;
  state: ConnectorVerifyStateName;
  toolCount?: number;
  latencyMs?: number;
  detail?: string;
  probeTool?: string | null;
};

export type ConnectorVerifyPayload =
  | { status: "unauthenticated"; results: [] }
  | { status: "ok"; results: ConnectorVerifyResult[] };

const SECRETISH =
  /\b(Bearer\s+[A-Za-z0-9._\-]+|ya29\.[A-Za-z0-9._\-]+|xox[a-z]-[A-Za-z0-9-]+|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|secret[=:]\s*\S+|token[=:]\s*\S+|password[=:]\s*\S+)/gi;

/** Strip tokens / credential-looking fragments from error text. */
export function sanitizeVerifyError(raw: unknown, fallback = "Verification failed."): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : fallback;
  const cleaned = text
    .replace(SECRETISH, "[redacted]")
    .replace(/[A-Za-z0-9_\-]{40,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || fallback;
}

/** Format a verified state for the Tools panel (never invents "connected"). */
export function formatVerifyBadge(result: ConnectorVerifyResult | undefined): string {
  if (!result) return "Not verified";
  switch (result.state) {
    case "ok": {
      const tools = typeof result.toolCount === "number" ? ` · ${result.toolCount} tool(s)` : "";
      const ms = typeof result.latencyMs === "number" ? ` · ${result.latencyMs}ms` : "";
      return `Verified${tools}${ms}`;
    }
    case "not_connected":
      return "Not connected";
    case "auth_expired":
      return "Auth expired";
    case "timeout":
      return "Timed out";
    case "error":
    default:
      return "Error";
  }
}

export function buildConnectorVerifyPayload(
  userId: string | null,
  results: ConnectorVerifyResult[],
): ConnectorVerifyPayload {
  if (!userId) return { status: "unauthenticated", results: [] };
  return { status: "ok", results };
}
