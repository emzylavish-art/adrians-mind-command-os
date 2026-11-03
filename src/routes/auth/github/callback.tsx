import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { handleFirstPartyOAuthCallback } = await import(
            "@/lib/supabase/first-party-oauth.server"
          );
          return await handleFirstPartyOAuthCallback({
            provider: "github",
            request,
          });
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
