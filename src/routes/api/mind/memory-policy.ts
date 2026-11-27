import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readOwnerMemoryPolicy, writeOwnerMemoryPolicy } from "@/lib/mind/memory/policy.server";

function reply(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
async function owner(request: Request) {
  const header = request.headers.get("authorization");
  return requireUserId(header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined);
}

export const Route = createFileRoute("/api/mind/memory-policy")({
  server: { handlers: {
    GET: async ({ request }) => {
      let userId: string;
      try { userId = await owner(request); } catch { return reply({ ok: false, error: "Sign in is required." }, 401); }
      try { return reply({ ok: true, policy: await readOwnerMemoryPolicy(userId) }); }
      catch { return reply({ ok: false, error: "Account memory privacy is unavailable." }, 503); }
    },
    POST: async ({ request }) => {
      const origin = assertSameOrigin(request);
      if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
      let userId: string;
      try { userId = await owner(request); } catch { return reply({ ok: false, error: "Sign in is required." }, 401); }
      let data: unknown;
      try { const raw = await request.text(); if (raw.length > 1000) return reply({ ok: false, error: "Invalid memory setting." }, 413); data = JSON.parse(raw); }
      catch { return reply({ ok: false, error: "Invalid memory setting." }, 400); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return reply({ ok: false, error: "Invalid memory setting." }, 400);
      const row = data as Record<string, unknown>;
      if (typeof row.suspended !== "boolean" || !Number.isSafeInteger(row.expectedRevision)) return reply({ ok: false, error: "Load the current memory setting first." }, 400);
      const result = await writeOwnerMemoryPolicy(userId, row.suspended, row.expectedRevision as number);
      return reply(result, result.ok ? 200 : result.conflict ? 409 : 503);
    },
  } },
});
