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

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Non-text MCP parts stay as JSON fields TanStack can serialize. No unknown index. */
export type McpContentPart = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  blob?: string;
};

export type McpCallRpc = {
  isError: boolean;
  content: McpContentPart[];
  structuredContent: JsonValue | null;
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

export function toJsonValue(value: unknown, secret = "", depth = 0): JsonValue | undefined {
  if (depth > 8) return undefined;
  if (typeof value === "string") return (secret ? value.split(secret).join("[redacted]") : value).slice(0, 8000);
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const item of value.slice(0, 40)) {
      const next = toJsonValue(item, secret, depth + 1);
      if (next !== undefined) out.push(next);
    }
    return out;
  }
  if (typeof value === "object" && value) {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      const next = toJsonValue(item, secret, depth + 1);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return undefined;
}

const CONTENT_FIELDS = ["text", "data", "mimeType", "uri", "name", "blob"] as const;

export function toContentPart(value: unknown, secret = ""): McpContentPart | null {
  const json = toJsonValue(value, secret);
  if (!json || typeof json !== "object" || Array.isArray(json) || typeof json.type !== "string") return null;
  const part: McpContentPart = { type: json.type };
  for (const key of CONTENT_FIELDS) {
    const field = json[key];
    if (typeof field === "string") part[key] = field;
  }
  return part;
}

export function mcpRpcFromResult(result: unknown, secret = ""): McpCallRpc {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (!("content" in record) && !("isError" in record) && !("structuredContent" in record)) return null;
  if (record.isError === true) {
    return { isError: true, content: [{ type: "text", text: safeReason("error") }], structuredContent: null };
  }
  const content = Array.isArray(record.content)
    ? record.content.map((part) => toContentPart(part, secret)).filter((part): part is McpContentPart => Boolean(part)).slice(0, 20)
    : [];
  const structured = record.structuredContent === undefined ? null : toJsonValue(record.structuredContent, secret) ?? null;
  return { isError: record.isError === true, content, structuredContent: structured };
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

export const MCP_BACKEND_CONTRACT_VERSION = 1;

const DISPLAY_REASONS: Record<McpResultCode, string> = {
  ok: "The call finished.",
  error: "The call failed.",
  unauthorized: "The server refused the call.",
  missing_config: "Not configured. Nothing was retried.",
  incompatible: "The call does not match the advertised schema.",
  ssrf_denied: "That address is not allowed.",
  timeout: "The server did not answer in time. Nothing was retried.",
  disabled: "The server is disabled.",
};

/** One fixed line for a banner. The upstream body is ignored. */
export function safeReason(code: McpResultCode, _upstreamBody?: string): string {
  return DISPLAY_REASONS[code];
}

/** Only the known sign-in refusal is public; arbitrary exceptions may hold secrets. */
export function mcpPublicException(error: unknown): { status: 401 | 500; message: string } {
  return error instanceof Error && error.message === "Unauthorized"
    ? { status: 401, message: "Sign in is required." }
    : { status: 500, message: safeReason("error") };
}

export function reasonCode(status: string): McpResultCode {
  if (status === "ok" || status === "unauthorized" || status === "missing_config" || status === "incompatible" || status === "timeout" || status === "disabled" || status === "ssrf_denied") {
    return status;
  }
  return "error";
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

/**
 * This version: no automatic retry and no banner Retry after a timeout or
 * transport failure, including an allow-listed read.
 * A candidate consumer rule would offer one manual Retry for safe reads.
 * That rule is not implemented and is not agreed.
 */
export function timeoutRetryDecision(input: { code: string; readSafe: boolean }): {
  retryable: false;
  autoRetried: false;
  bannerRetry: false;
} {
  void input;
  return { retryable: false, autoRetried: false, bannerRetry: false };
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
