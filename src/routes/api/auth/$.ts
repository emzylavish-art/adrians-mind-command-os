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
    const { auth } = await import("@/lib/auth/server");
    return await auth.handler(request);
  } catch (error) {
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
