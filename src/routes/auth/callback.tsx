import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleAuthCallback } = await import(
          "@/lib/supabase/callback.server"
        );
        return handleAuthCallback(request);
      },
    },
  },
});
