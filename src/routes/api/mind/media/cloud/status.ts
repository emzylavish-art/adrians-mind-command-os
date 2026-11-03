import { createFileRoute } from "@tanstack/react-router";
import { handleCloudStatus } from "@/lib/mind/media/cloud/http";

export const Route = createFileRoute("/api/mind/media/cloud/status")({
  server: {
    handlers: {
      GET: ({ request }) => handleCloudStatus(request),
    },
  },
});
