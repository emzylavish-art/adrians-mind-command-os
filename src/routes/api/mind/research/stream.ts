import { createFileRoute } from "@tanstack/react-router";
import { handleResearchStream } from "@/lib/mind/research-session.server";

export const Route = createFileRoute("/api/mind/research/stream")({
  server: {
    handlers: {
      GET: ({ request }) => handleResearchStream(request),
    },
  },
});
