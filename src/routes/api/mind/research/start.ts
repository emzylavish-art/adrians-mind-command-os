import { createFileRoute } from "@tanstack/react-router";
import { handleResearchStart } from "@/lib/mind/research-session.server";

export const Route = createFileRoute("/api/mind/research/start")({
  server: {
    handlers: {
      POST: ({ request }) => handleResearchStart(request),
    },
  },
});
