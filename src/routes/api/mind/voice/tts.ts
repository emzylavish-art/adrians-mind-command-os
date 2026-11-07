import { createFileRoute } from "@tanstack/react-router";
import { handleVoiceTts } from "@/lib/mind/voice/http.server";

export const Route = createFileRoute("/api/mind/voice/tts")({
  server: {
    handlers: {
      POST: ({ request }) => handleVoiceTts(request),
    },
  },
});