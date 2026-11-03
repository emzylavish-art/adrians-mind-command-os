import { createFileRoute } from "@tanstack/react-router";
import { handleResearchCancel } from "@/lib/mind/research-session.server";

export const Route = createFileRoute("/api/mind/research/cancel")({
  server: {
    handlers: {
      POST: ({ request }) => handleResearchCancel(request),
    },
  },
});
