import { createFileRoute } from "@tanstack/react-router";
import { handleVoiceSession } from "@/lib/mind/voice/http.server";

export const Route = createFileRoute("/api/mind/voice/session")({
  server: {
    handlers: {
      POST: ({ request }) => handleVoiceSession(request),
    },
  },
});
