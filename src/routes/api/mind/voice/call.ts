import { createFileRoute } from "@tanstack/react-router";
import { handleVoiceCall } from "@/lib/mind/voice/call.server";

export const Route = createFileRoute("/api/mind/voice/call")({
  server: {
    handlers: {
      POST: ({ request }) => handleVoiceCall(request),
    },
  },
});
