import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { saveCustomConnection } from "@/lib/mind/custom-connection";
import { kimiDeviceStatus, pollKimiDeviceLogin, startKimiDeviceLogin } from "@/lib/mind/kimi/device-login.server";
import { listKimiPlugins } from "@/lib/mind/kimi/plugin-catalog.server";
import { handleKimiProviders } from "@/lib/mind/kimi/phase4.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bearer(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  return authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
}

export const Route = createFileRoute("/api/mind/build/providers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("view") !== "kimi") return handleKimiProviders(request);
        try {
          const userId = await requireUserId(bearer(request));
          const status = await kimiDeviceStatus(userId);
          const plugins = status.state === "connected" ? await listKimiPlugins(userId) : { ok: true as const, plugins: [] };
          return json({ ok: true, ...status, plugins: plugins.ok ? plugins.plugins : [], pluginError: plugins.ok ? undefined : plugins.error });
        } catch {
          return json({ ok: false, error: "Sign in is required." }, 401);
        }
      },
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        const body = (await request.clone().json().catch(() => ({}))) as { action?: string; label?: string; url?: string; transport?: string };
        if (!body.action || body.action === "save") return handleKimiProviders(request);
        try {
          const userId = await requireUserId(bearer(request));
          if (body.action === "device_start") return json(await startKimiDeviceLogin(userId));
          if (body.action === "device_poll") return json(await pollKimiDeviceLogin(userId));
          if (body.action === "mcp_save") {
            const saved = await saveCustomConnection(null, userId, {
              label: body.label || "Kimi MCP",
              kind: "mcp",
              url: body.url || "",
              auth: "none",
            });
            return json(saved, saved.ok ? 200 : 400);
          }
          return json({ ok: false, error: "Unknown Kimi connection action." }, 400);
        } catch {
          return json({ ok: false, error: "Sign in is required." }, 401);
        }
      },
    },
  },
});
