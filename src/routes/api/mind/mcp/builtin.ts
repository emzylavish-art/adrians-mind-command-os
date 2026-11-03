import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { handleBuiltinMcpHttp } from "@/lib/mind/mcp/builtin-server";

/**
 * Built-in MCP over Streamable HTTP. Requires a signed-in session (cookie or
 * `Authorization: Bearer <session>`): it exposes pglite_query, notion_* and
 * pc_run_shell, so anonymous callers get 401 and nothing runs.
 */
async function handle({ request }: { request: Request }) {
  // State-changing MCP JSON-RPC (tools/call) must be same-origin; allow missing
  // Origin for non-browser/bearer clients per assertSameOrigin policy.
  if (request.method !== "GET") {
    const originCheck = assertSameOrigin(request);
    if (!originCheck.ok) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: originCheck.error }, id: null }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return handleBuiltinMcpHttp(request, {
    authenticate: async (req) => {
      const authorization = req.headers.get("authorization");
      const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
      return requireUserId(bearer);
    },
    isHalted: async (userId) => {
      const { haltIsOn } = await import("@/lib/mind/halt.server");
      return haltIsOn(userId);
    },
  });
}

export const Route = createFileRoute("/api/mind/mcp/builtin")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      DELETE: handle,
    },
  },
});
