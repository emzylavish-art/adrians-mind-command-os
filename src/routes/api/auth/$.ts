import { createFileRoute } from "@tanstack/react-router";

function safeError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 500);
}

async function handle(request: Request): Promise<Response> {
  try {
    const { auth } = await import("@/lib/auth/server");
    return await auth.handler(request);
  } catch (error) {
    return new Response(safeError(error), {
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
