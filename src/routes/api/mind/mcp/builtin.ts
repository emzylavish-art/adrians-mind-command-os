import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { handleBuiltinMcpHttp } from "@/lib/mind/mcp/builtin-server";

/**
 * Built-in MCP over Streamable HTTP. Requires a signed-in session (cookie or
 * `Authorization: Bearer <session>`): it exposes pglite_query, notion_* and
 * pc_run_shell, so anonymous callers get 401 and nothing runs.
 */
async function handle({ request }: { request: Request }) {
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
