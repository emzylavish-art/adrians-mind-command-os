import { haltIsOn } from "@/lib/mind/halt.server";
import { externalResourceCall } from "@/lib/mind/external-resource-call.server";
import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { allowSharedMindRequest as allowMindRequest } from "@/lib/mind/rate-limit.server";
import { NUANCE_PERSONAS, redactSecrets } from "@/lib/mind/nuance-live";
import {
  endSavedConversation,
  listSavedActiveConversations,
  mintSavedNuanceSessionForPersona,
  readNuanceKey,
} from "@/lib/mind/nuance-live.server";

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function caller(request: Request): Promise<string | Response> {
  try {
    return await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined);
  } catch {
    return reply({ ok: false, error: "Sign in is required." }, 401);
  }
}

export const Route = createFileRoute("/api/mind/nuance/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await caller(request);
        if (user instanceof Response) return user;
        const active = readNuanceKey() ? await listSavedActiveConversations() : { ok: true as const, ids: [] };
        return reply({
          ok: true,
          configured: readNuanceKey() !== null,
          personas: NUANCE_PERSONAS,
          active: active.ok ? active.ids.length : 0,
        });
      },
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
        const user = await caller(request);
        if (user instanceof Response) return user;
        if (!await allowMindRequest("nuance_session", user, 8)) {
          return reply({ ok: false, error: "Too many video calls. Please wait." }, 429);
        }
        let camera = false;
        let persona = "sonia";
        let action = "start";
        let endId = "";
        try {
          const text = await request.text();
          if (text.length > 2000) return reply({ ok: false, error: "That request is too large." }, 400);
          if (text.trim()) {
            const body = JSON.parse(text) as { camera?: unknown; persona?: unknown; action?: unknown; id?: unknown };
            camera = body.camera === true;
            if (typeof body.persona === "string") persona = body.persona;
            if (body.action === "end") action = "end";
            if (typeof body.id === "string") endId = body.id;
          }
        } catch {
          return reply({ ok: false, error: "The video call request was not understood." }, 400);
        }
        if (action === "end") {
          if (endId) {
            const ended = await endSavedConversation(endId);
            if (!ended.ok) return reply({ ok: false, error: ended.error }, 502);
            return reply({ ok: true, ended: 1 });
          }
          const active = await listSavedActiveConversations();
          if (!active.ok) return reply({ ok: false, error: active.error }, active.status);
          for (const id of active.ids) {
            const ended = await endSavedConversation(id);
            if (!ended.ok) return reply({ ok: false, error: ended.error }, 502);
          }
          return reply({ ok: true, ended: active.ids.length });
        }
        if (await haltIsOn(user)) return reply({ ok: false, error: "Emergency stop is on or unavailable. Session was not started." }, 403);
        const minted = await externalResourceCall({ owner: user, provider: "nuance", model: persona, unknownTokens: true }, () => mintSavedNuanceSessionForPersona(user, camera, persona));
        if (!minted.ok) return reply({ ok: false, error: redactSecrets(minted.error) }, minted.status);
        return reply({ ok: true, token: minted.token, persona });
      },
    },
  },
});
