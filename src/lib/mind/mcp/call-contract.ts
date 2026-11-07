/**
 * Additive MCP call contract.
 *
 * Legacy fields `ok`, `status`, `serverId`, `tool`, `text`, and `data` stay.
 * `/api/mind/mcp/call` still returns HTTP 200 for a finished tool attempt.
 * Sign-in stays 401. A cross-site POST stays 403. Emergency stop stays 403.
 *
 * `transport` is the HTTP exchange with the upstream MCP server.
 * `rpc` is the JSON-RPC tool result when the upstream actually returned one,
 * including non-text content parts. It is null when the call never produced
 * a JSON-RPC result (unauthorized, transport failure, built-in tool, or a
 * refusal before the request).
 */
export type McpResultCode =
  | "ok"
  | "error"
  | "unauthorized"
  | "missing_config"
  | "incompatible"
  | "ssrf_denied"
  | "timeout"
  | "disabled";

export type McpCallTransport = { ok: boolean; status: number; ms: number };

export type McpContentPart = { type: string; text?: string; [key: string]: unknown };

export type McpCallRpc = {
  isError: boolean;
  content: McpContentPart[];
  structuredContent: unknown | null;
} | null;

export type McpCallContract = {
  ok: boolean;
  status: string;
  serverId: string;
  tool: string;
  text: string;
  data?: unknown;
  code: McpResultCode;
  transport: McpCallTransport | null;
  rpc: McpCallRpc;
};

export function mcpResultCode(text: string, status: string, ok: boolean): McpResultCode {
  if (ok) return "ok";
  if (status === "timeout" || /did not answer within/i.test(text)) return "timeout";
  if (/disabled/i.test(text)) return "disabled";
  if (/private|link-local|metadata|refused/i.test(text)) return "ssrf_denied";
  if (status === "unauthorized" || /returned 401|returned 403|sign in is required/i.test(text)) return "unauthorized";
  if (status === "missing_config" || /DATABASE_URL or POSTGRES_URL|CONNECTOR_TOKEN_SECRET|no token is stored|cannot be decrypted|not configured/i.test(text)) return "missing_config";
  if (status === "incompatible" || /argument schema|unexpected argument|missing /i.test(text)) return "incompatible";
  return "error";
}

export function toMcpCallContract(input: {
  ok: boolean;
  status: string;
  serverId?: string;
  tool?: string;
  text?: string;
  data?: unknown;
  ms: number;
  code?: McpResultCode;
  transport?: McpCallTransport | null;
  rpc?: McpCallRpc;
}): McpCallContract {
  const text = input.text ?? "";
  const code = input.code ?? mcpResultCode(text, input.status, input.ok);
  return {
    ok: input.ok,
    status: input.status,
    serverId: input.serverId ?? "",
    tool: input.tool ?? "",
    text,
    ...(input.data !== undefined ? { data: input.data } : {}),
    code,
    transport: input.transport === undefined ? null : input.transport,
    rpc: input.rpc === undefined ? null : input.rpc,
  };
}

/** Error text only. Removes a known secret, header assignments, and URL literals. */
export function privacyErrorText(text: string, secret = ""): string {
  let out = secret ? text.split(secret).join("[redacted]") : text;
  out = out.replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*\S+/gi, "$1: [redacted]");
  out = out.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
  out = out.replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s)"']+/g, "[url]");
  out = out.replace(/"(password|token|secret|authorization|api_key|api-key)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"');
  return out.slice(0, 8000);
}

/** One line for a person. Not a raw body, header, query string, or credential. */
export function safeReason(text: string, secret = ""): string {
  return privacyErrorText(text, secret).replace(/\s+/g, " ").trim().slice(0, 240);
}

export const MISSING_CONFIG_COPY = "Not configured. Nothing was retried.";

/** Database and token setup failures. retryable is always false. */
export function missingConfigNotice(input: { code?: string; text?: string }): { copy: typeof MISSING_CONFIG_COPY; retryable: false } | null {
  const text = input.text ?? "";
  const code = input.code === "missing_config" ? "missing_config" : mcpResultCode(text, "error", false);
  if (code !== "missing_config") return null;
  return { copy: MISSING_CONFIG_COPY, retryable: false };
}

/** Tools this process treats as reads. Nothing else is read-safe. */
export const READ_SAFE_ALLOWLIST = ["pglite_list_schema"] as const;

export function isKnownReadSafe(input: { kind: "mcp" | "http"; method?: string; tool: string }): boolean {
  if (input.kind === "http" && input.method === "GET" && input.tool === "request") return true;
  return (READ_SAFE_ALLOWLIST as readonly string[]).includes(input.tool);
}

/** A finished attempt is never sent again, including a timed-out read. */
export function timeoutRetryDecision(input: { code: string; readSafe: boolean }): { retryable: false; autoRetried: false } {
  void input;
  return { retryable: false, autoRetried: false };
}

export type CallProvenance = {
  /** Created in this process for this click. Not an upstream id. */
  localAttemptId: string;
  /** This path does not read x-request-id or any upstream correlation header. */
  upstreamRequestId: null;
};

export function callProvenance(localAttemptId: string): CallProvenance {
  return { localAttemptId, upstreamRequestId: null };
}
