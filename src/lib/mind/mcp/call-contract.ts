/**
 * Additive MCP call contract. Existing fields ok/status/text/serverId/tool/data stay.
 * HTTP status of /api/mind/mcp/call stays 200 for tool outcomes so older clients
 * that only read the body are not broken. Auth and CSRF responses stay 401/403.
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

export type McpCallRpc = {
  isError: boolean;
  content: { type: "text"; text: string }[];
  structuredContent: unknown | null;
};

export type McpCallContract = {
  ok: boolean;
  status: string;
  serverId: string;
  tool: string;
  text: string;
  data?: unknown;
  code: McpResultCode;
  transport: McpCallTransport;
  rpc: McpCallRpc;
};

export function mcpResultCode(text: string, status: string, ok: boolean): McpResultCode {
  if (ok) return "ok";
  if (status === "timeout" || /did not answer within/i.test(text)) return "timeout";
  if (/disabled/i.test(text)) return "disabled";
  if (/private|link-local|metadata|refused/i.test(text)) return "ssrf_denied";
  if (status === "unauthorized" || /returned 401|returned 403|sign in is required/i.test(text)) return "unauthorized";
  if (status === "missing_config" || /no token is stored|not configured/i.test(text)) return "missing_config";
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
}): McpCallContract {
  const text = input.text ?? "";
  const code = mcpResultCode(text, input.status, input.ok);
  const http = /returned (\d{3})/.exec(text);
  const transportStatus = code === "timeout" ? 0 : http ? Number(http[1]) : input.ok ? 200 : 0;
  return {
    ok: input.ok,
    status: input.status,
    serverId: input.serverId ?? "",
    tool: input.tool ?? "",
    text,
    ...(input.data !== undefined ? { data: input.data } : {}),
    code,
    transport: { ok: code !== "timeout" && code !== "ssrf_denied" && !/could not be reached/i.test(text), status: transportStatus, ms: input.ms },
    rpc: {
      isError: !input.ok,
      content: [{ type: "text", text }],
      structuredContent: input.data ?? null,
    },
  };
}
