/**
 * MCP registry HTTP API.
 *
 * Anonymous GET returns 401 "Sign in is required." — correct for this REST
 * surface. The in-app Tools UI does NOT call this route; it uses the soft-auth
 * mcpRegistryList server function (typed `unauthenticated`, quiet sign-in
 * notice). Only live verify scripts probe this path. Keep the 401.
 */
import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import {
  listRegistryServers,
  registerExternalServer,
  removeRegistryServer,
  setServerEnabled,
} from "@/lib/mind/mcp/registry";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/mind/mcp/servers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          return json({ ok: true, servers: listRegistryServers(userId) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
      POST: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const body = (await request.json().catch(() => ({}))) as {
            action?: string;
            id?: string;
            enabled?: boolean;
            label?: string;
            url?: string;
            command?: string;
            args?: string[];
            token?: string;
            env?: Record<string, unknown>;
            connectTimeoutMs?: number;
            callTimeoutMs?: number;
          };
          if (body.action === "toggle" && typeof body.id === "string") {
            return json({ ok: true, servers: setServerEnabled(userId, body.id, body.enabled === true) });
          }
          if (body.action === "remove" && typeof body.id === "string") {
            return json({ ok: true, servers: removeRegistryServer(userId, body.id) });
          }
          if (body.action === "register") {
            const saved = registerExternalServer(userId, {
              label: body.label ?? "",
              url: body.url,
              command: body.command,
              args: body.args,
              token: body.token,
              env: body.env,
              connectTimeoutMs: body.connectTimeoutMs,
              callTimeoutMs: body.callTimeoutMs,
            });
            if (!saved.ok) return json(saved, 400);
            return json(saved);
          }
          return json({ ok: false, error: "Unknown action. Use toggle, remove, or register." }, 400);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          return json({ ok: false, error: message === "Unauthorized" ? "Sign in is required." : message }, message === "Unauthorized" ? 401 : 403);
        }
      },
    },
  },
});
