import { createFileRoute } from "@tanstack/react-router";
import { handleBuildSessionSteer } from "@/lib/mind/build-session.server";

export const Route = createFileRoute("/api/mind/build-session/steer")({
  server: {
    handlers: {
      POST: ({ request }) => handleBuildSessionSteer(request),
    },
  },
});
