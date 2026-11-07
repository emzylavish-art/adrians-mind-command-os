import { createFileRoute } from "@tanstack/react-router";
import { handleVoiceStt } from "@/lib/mind/voice/http.server";

export const Route = createFileRoute("/api/mind/voice/stt")({
  server: {
    handlers: {
      POST: ({ request }) => handleVoiceStt(request),
    },
  },
});
