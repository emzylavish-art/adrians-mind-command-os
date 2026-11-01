import { createFileRoute } from "@tanstack/react-router";
import { handleCloudFetch } from "@/lib/mind/media/cloud/http";

export const Route = createFileRoute("/api/mind/media/cloud/fetch")({
  server: {
    handlers: {
      POST: ({ request }) => handleCloudFetch(request),
    },
  },
});
