import { createFileRoute } from "@tanstack/react-router";
import { requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { allowMindRequest } from "@/lib/mind/limits";
import { readHaltState } from "@/lib/mind/halt.server";
import { listEnvironmentModelCatalogs, refreshEnvironmentModelCatalog } from "@/lib/mind/environment-model-catalog.server";
import {
  listAiProviders, saveAiProvider, deleteAiProvider, discoverAiModels, setAiProviderModel, rotateAiProviderKey, listAiProviderDependencies,
} from "@/lib/mind/ai-provider-config.server";

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function owner(request: Request): Promise<string> {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  return requireUserId(bearer);
}

export const Route = createFileRoute("/api/mind/providers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const userId = await owner(request);
          return reply({ ok: true, providers: await listAiProviders(userId), environmentCatalogs: await listEnvironmentModelCatalogs(userId) });
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            return reply({ ok: false, error: "Sign in is required." }, 401);
          }
          return reply({ ok: false, error: "Provider settings are unavailable. Try again shortly." }, 503);
        }
      },
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
        let userId: string;
        try { userId = await owner(request); }
        catch { return reply({ ok: false, error: "Sign in is required." }, 401); }
        if (!allowMindRequest("provider_config", userId, 15)) {
          return reply({ ok: false, error: "Too many provider changes. Please wait." }, 429);
        }
        let data: Record<string, unknown>;
        try {
          const raw = await request.text();
          if (raw.length > 6000) return reply({ ok: false, error: "The provider configuration is too large." }, 413);
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reply({ ok: false, error: "Invalid input." }, 400);
          data = parsed as Record<string, unknown>;
        } catch { return reply({ ok: false, error: "Invalid JSON input." }, 400); }
        try {
          if (data.action === "save" || data.action === "discover" || data.action === "discover-environment") {
            const halt = await readHaltState(userId);
            if (halt === "unknown") return reply({ ok: false, error: "Emergency stop status is unavailable. Try again when storage is reachable." }, 503);
            if (halt === "on") return reply({ ok: false, error: "Emergency stop is on. Model discovery is paused." }, 423);
          }
          if (data.action === "discover-environment") {
            const discovered = await refreshEnvironmentModelCatalog(userId, data.provider);
            return reply(discovered, discovered.ok ? 200 : 400);
          }
          if (data.action === "save") {
            const saved = await saveAiProvider(userId, data);
            if (!saved.ok) return reply(saved, 400);
            const discovered = await discoverAiModels(userId, saved.provider.id);
            return reply({ ok: true, saved: true, stage: "saved", provider: discovered.provider || saved.provider, discovery: { ok: discovered.ok, error: discovered.ok ? undefined : discovered.error }, inferenceVerified: false });
          }
          if (data.action === "discover" && typeof data.id === "string") {
            const discovered = await discoverAiModels(userId, data.id);
            return reply(discovered, discovered.ok ? 200 : 400);
          }
          if (data.action === "model" && typeof data.id === "string" && typeof data.model === "string") {
            const result = await setAiProviderModel(userId, data.id, data.model);
            return reply(result, result.ok ? 200 : 400);
          }
          if (data.action === "rotate-key" && typeof data.id === "string") {
            const result = await rotateAiProviderKey(userId, data.id, data.apiKey);
            return reply(result, result.ok ? 200 : 400);
          }
          if (data.action === "delete" && typeof data.id === "string") {
            const deleted = await deleteAiProvider(userId, data.id);
            return reply(deleted, deleted.ok ? 200 : 404);
          }
          if (data.action === "dependencies" && typeof data.id === "string") {
            const result = await listAiProviderDependencies(userId, data.id);
            return reply(result, result.ok ? 200 : 404);
          }
          return reply({ ok: false, error: "Unknown provider action." }, 400);
        } catch {
          return reply({ ok: false, error: "The provider database operation failed. Nothing was reported as successful." }, 503);
        }
      },
    },
  },
});
