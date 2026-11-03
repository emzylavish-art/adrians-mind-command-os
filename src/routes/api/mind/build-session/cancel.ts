import { createFileRoute } from "@tanstack/react-router";
import { handleBuildSessionCancel } from "@/lib/mind/build-session.server";

export const Route = createFileRoute("/api/mind/build-session/cancel")({
  server: {
    handlers: {
      POST: ({ request }) => handleBuildSessionCancel(request),
    },
  },
});
