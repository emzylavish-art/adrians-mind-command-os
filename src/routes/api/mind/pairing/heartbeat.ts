import { createFileRoute } from "@tanstack/react-router";
import { handleHeartbeat } from "@/lib/mind/pairing/pairing.server";

export const Route = createFileRoute("/api/mind/pairing/heartbeat")({
  server: {
    handlers: {
      POST: ({ request }) => handleHeartbeat(request),
    },
  },
});
