import { createFileRoute } from "@tanstack/react-router";
import { handleStorageStatus } from "@/lib/mind/media/storage/http";

export const Route = createFileRoute("/api/mind/media/storage/status")({
  server: {
    handlers: {
      GET: ({ request }) => handleStorageStatus(request),
    },
  },
});
