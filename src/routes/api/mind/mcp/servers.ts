/**
 * MCP registry HTTP API.
 *
 * Anonymous GET returns 401 "Sign in is required." — correct for this REST
 * surface. The in-app Tools UI does NOT call this route; it uses the soft-auth
 * mcpRegistryList server function (typed `unauthenticated`, quiet sign-in
 * notice). Only live verify scripts probe this path. Keep the 401.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { mcpPublicException } from "@/lib/mind/mcp/call-contract";
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
          const { databaseConfigured } = await import("@/lib/mind/mcp/registry-store");
          const db = databaseConfigured() ? await getSql() : null;
          return json({ ok: true, servers: await listRegistryServers(userId, db) });
        } catch (error) {
          const failure = mcpPublicException(error);
          return json({ ok: false, error: failure.message }, failure.status);
        }
      },
      POST: async ({ request }) => {
        try {
          const originCheck = assertSameOrigin(request);
          if (!originCheck.ok) return json({ ok: false, error: originCheck.error }, 403);
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const { databaseConfigured } = await import("@/lib/mind/mcp/registry-store");
          const db = databaseConfigured() ? await getSql() : null;
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
            return json({ ok: true, servers: await setServerEnabled(userId, body.id, body.enabled === true, db) });
          }
          if (body.action === "remove" && typeof body.id === "string") {
            return json({ ok: true, servers: await removeRegistryServer(userId, body.id, db) });
          }
          if (body.action === "register") {
            const saved = await registerExternalServer(userId, {
              label: body.label ?? "",
              url: body.url,
              command: body.command,
              args: body.args,
              token: body.token,
              env: body.env,
              connectTimeoutMs: body.connectTimeoutMs,
              callTimeoutMs: body.callTimeoutMs,
            }, db);
            if (!saved.ok) return json(saved, 400);
            return json(saved);
          }
          return json({ ok: false, error: "Unknown action. Use toggle, remove, or register." }, 400);
        } catch (error) {
          const failure = mcpPublicException(error);
          return json({ ok: false, error: failure.message }, failure.status);
        }
      },
    },
  },
});
