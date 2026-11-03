import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertAllowedRequestHost } from "@/lib/mind/mcp/request-host";
import { listRegistryTools } from "@/lib/mind/mcp/registry";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/mind/mcp/tools")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const hostCheck = assertAllowedRequestHost(request);
          if (!hostCheck.ok) return json({ ok: false, error: hostCheck.error }, 403);
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const { haltIsOn } = await import("@/lib/mind/halt.server");
          const tools = await listRegistryTools(userId, undefined, { isHalted: haltIsOn });
          return json({ ok: true, tools });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
