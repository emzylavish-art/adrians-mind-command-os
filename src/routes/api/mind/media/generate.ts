import { createFileRoute } from "@tanstack/react-router";
import { handleImagineGenerate, handleImagineStatus } from "@/lib/mind/media/imagine-http";

export const Route = createFileRoute("/api/mind/media/generate")({
  server: {
    handlers: {
      GET: ({ request }) => handleImagineStatus(request),
      POST: ({ request }) => handleImagineGenerate(request),
    },
  },
});
