import { createFileRoute } from "@tanstack/react-router";

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return "AUTH_HANDLER_FAILURE";
}

async function handle(request: Request): Promise<Response> {
  try {
    if (request.method === "GET" && new URL(request.url).pathname.endsWith("/api/auth/owner")) {
      const { getSessionUser, isLoopbackPreview } = await import("@/lib/auth/verify.server");
      const authorization = request.headers.get("authorization");
      const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
      const user = isLoopbackPreview() ? { id: "dev-user", email: null } : await getSessionUser(bearer);
      return Response.json({ user }, { headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST" && new URL(request.url).pathname.endsWith("/api/auth/owner-sign-out")) {
      const { assertSameOrigin } = await import("@/lib/mind/connectors/oauth-csrf");
      const origin = assertSameOrigin(request);
      if (!origin.ok) return Response.json({ error: origin.error }, { status: 403 });
      const { readSupabaseEnv, createSupabaseServerClient } = await import("@/lib/supabase/server");
      if (readSupabaseEnv()) {
        const result = await createSupabaseServerClient().auth.signOut();
        if (result.error) return Response.json({ error: "The account session could not be ended. Retry sign out." }, { status: 503 });
      }
      return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    }
    const { auth } = await import("@/lib/auth/server");
    return await auth.handler(request);
  } catch (error) {
    if (error instanceof Error && error.name === "SessionConflictError") return Response.json({ user: null, error: error.message, code: "ACCOUNT_CONFLICT" }, { status: 409, headers: { "cache-control": "no-store" } });
    console.error("Authentication handler failed", { code: safeErrorCode(error) });
    return new Response("Unable to process authentication request.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
