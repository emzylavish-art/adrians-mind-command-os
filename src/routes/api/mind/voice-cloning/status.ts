import { createFileRoute } from "@tanstack/react-router";
import { createVoiceCloningService } from "@/lib/mind/voice-cloning/service";

export const Route = createFileRoute("/api/mind/voice-cloning/status")({
  server: {
    handlers: {
      GET: async () => {
        const status = await createVoiceCloningService().getStatus();
        return Response.json(status);
      },
    },
  },
});
