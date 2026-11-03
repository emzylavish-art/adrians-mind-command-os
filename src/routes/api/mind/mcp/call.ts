import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { assertAllowedRequestHost } from "@/lib/mind/mcp/request-host";
import { callRegistryTool } from "@/lib/mind/mcp/registry";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/mind/mcp/call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const hostCheck = assertAllowedRequestHost(request);
          if (!hostCheck.ok) return json({ ok: false, error: hostCheck.error }, 403);
          const originCheck = assertSameOrigin(request);
          if (!originCheck.ok) return json({ ok: false, error: originCheck.error }, 403);
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const { haltIsOn } = await import("@/lib/mind/halt.server");
          if (await haltIsOn(userId)) {
            return json({ ok: false, status: "error", text: "Emergency stop is on. No MCP tool was called." }, 403);
          }
          const body = (await request.json().catch(() => ({}))) as {
            serverId?: string;
            tool?: string;
            args?: Record<string, unknown>;
          };
          const serverId = typeof body.serverId === "string" ? body.serverId.slice(0, 80) : "";
          const tool = typeof body.tool === "string" ? body.tool.slice(0, 80) : "";
          if (!serverId || !tool) return json({ ok: false, status: "error", text: "serverId and tool are required. Nothing was called." }, 400);
          const result = await callRegistryTool({
            userId,
            serverId,
            tool,
            args: body.args && typeof body.args === "object" ? body.args : {},
            getSql,
            isHalted: haltIsOn,
          });
          return json(result, result.ok ? 200 : 200);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, status: "error", text: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
