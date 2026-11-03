import { createFileRoute } from "@tanstack/react-router";
import { handleBuildSessionStart } from "@/lib/mind/build-session.server";

export const Route = createFileRoute("/api/mind/build-session/start")({
  server: {
    handlers: {
      POST: ({ request }) => handleBuildSessionStart(request),
    },
  },
});
