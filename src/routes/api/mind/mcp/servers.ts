/**
 * MCP registry HTTP API.
 *
 * Anonymous GET returns 401 "Sign in is required." — correct for this REST
 * surface. The in-app Tools UI normally uses the soft-auth server function
 * (typed `unauthenticated`). A browser-side transport failure can trigger
 * one authenticated, read-only REST fallback. Keep the anonymous 401.
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
    headers: { "content-type": "application/json", "cache-control": "no-store" },
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
          const view = new URL(request.url).searchParams.get("view") ?? "registry";
          if (view === "saved") {
            const { listConnectedMcp } = await import("@/lib/mind/connected-mcp.server");
            return json({ ok: true, servers: await listConnectedMcp(db, userId) });
          }
          if (view === "health") {
            // Authenticated, read-only diagnostics. No keys, database URL,
            // OAuth tokens or foreign-user records are included.
            if (!db) return json({ ok: false, code: "database_not_configured", message: "A durable database is required." }, 503);
            let migrated: string[];
            try {
              const rows = await db.query<{ name: string }>("SELECT name FROM _migrations");
              migrated = rows.map((row) => row.name);
            } catch {
              return json({ ok: false, code: "migration_table_unavailable", message: "Migration records could not be read." }, 503);
            }
            const required = ["0005_custom_connection.sql", "0006_ai_providers.sql", "0007_oauth_connections.sql"];
            const migrations = Object.fromEntries(required.map((name) => [name, migrated.includes(name)]));
            if (required.some((name) => !migrated.includes(name))) {
              return json({ ok: false, code: "migrations_pending", migrations }, 503);
            }
            try {
              const rows = await db.query<{ count: number }>(
                "SELECT COUNT(*)::int AS count FROM mind_mcp_registry WHERE user_id = $1",
                [userId],
              );
              return json({ ok: true, code: "ready", migrations, savedRegistryRows: rows[0]?.count ?? 0 });
            } catch {
              return json({ ok: false, code: "registry_table_unavailable", migrations }, 503);
            }
          }
          if (view !== "registry") return json({ ok: false, code: "unknown_view" }, 400);
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
