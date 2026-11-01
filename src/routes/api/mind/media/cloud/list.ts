import { createFileRoute } from "@tanstack/react-router";
import { handleCloudList } from "@/lib/mind/media/cloud/http";

export const Route = createFileRoute("/api/mind/media/cloud/list")({
  server: {
    handlers: {
      GET: ({ request }) => handleCloudList(request),
    },
  },
});
