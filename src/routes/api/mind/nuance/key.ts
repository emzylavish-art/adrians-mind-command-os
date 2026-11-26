import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { allowSharedMindRequest as allowMindRequest } from "@/lib/mind/rate-limit.server";
import { saveNuanceKey } from "@/lib/mind/nuance-live.server";

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/mind/nuance/key")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
        let user: string;
        try {
          user = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined);
        } catch {
          return reply({ ok: false, error: "Sign in is required." }, 401);
        }
        if (!await allowMindRequest("nuance_key", user, 5)) {
          return reply({ ok: false, error: "Too many key changes. Please wait." }, 429);
        }
        let key = "";
        try {
          const text = await request.text();
          if (text.length > 2000) return reply({ ok: false, error: "That request is too large." }, 400);
          const body = JSON.parse(text) as { key?: unknown };
          key = typeof body.key === "string" ? body.key.trim() : "";
        } catch {
          return reply({ ok: false, error: "The key was not understood. Nothing was saved." }, 400);
        }
        const saved = saveNuanceKey(key);
        if (!saved.ok) return reply({ ok: false, error: saved.error }, 400);
        return reply({ ok: true, configured: true });
      },
    },
  },
});
