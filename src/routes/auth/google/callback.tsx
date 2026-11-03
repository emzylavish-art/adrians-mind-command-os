import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleFirstPartyOAuthCallback } = await import(
          "@/lib/supabase/first-party-oauth.server"
        );
        return handleFirstPartyOAuthCallback({
          provider: "google",
          request,
        });
      },
    },
  },
});
