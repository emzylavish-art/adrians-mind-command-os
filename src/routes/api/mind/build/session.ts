import { createFileRoute } from "@tanstack/react-router";
import { handleKimiSession } from "@/lib/mind/kimi/acp.server";

export const Route = createFileRoute("/api/mind/build/session")({
  server: {
    handlers: {
      GET: ({ request }) => handleKimiSession(request),
      POST: ({ request }) => handleKimiSession(request),
    },
  },
});
