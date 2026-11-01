import { createFileRoute } from "@tanstack/react-router";
import { handleAssetUrl } from "@/lib/mind/media/storage/asset-sign";

export const Route = createFileRoute("/api/mind/media/asset-url")({
  server: {
    handlers: {
      GET: ({ request }) => handleAssetUrl(request),
      POST: ({ request }) => handleAssetUrl(request),
    },
  },
});
