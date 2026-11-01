import { createFileRoute } from "@tanstack/react-router";
import { handleEmergencyStop, handleClearEmergencyStop } from "@/lib/mind/pairing/pairing.server";

export const Route = createFileRoute("/api/mind/pairing/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("op") === "clear") return handleClearEmergencyStop(request);
        return handleEmergencyStop(request);
      },
    },
  },
});
