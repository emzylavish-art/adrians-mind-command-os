import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { handleAuthCallback } = await import(
            "@/lib/supabase/callback.server"
          );
          return await handleAuthCallback(request);
        } catch {
          const url = new URL(request.url);
          const target = new URL("/login", url.origin);
          target.searchParams.set("next", "/dashboard");
          target.searchParams.set("error", "provider_failed");
          return new Response(null, {
            status: 302,
            headers: { Location: target.toString() },
          });
        }
      },
    },
  },
});
