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
  if (status === "missing_config" || /no token is stored|cannot be decrypted|not configured/i.test(text)) return "missing_config";
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
