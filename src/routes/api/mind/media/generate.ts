import { createFileRoute } from "@tanstack/react-router";
import { handleImagineGenerate } from "@/lib/mind/media/imagine-http";

export const Route = createFileRoute("/api/mind/media/generate")({
  server: {
    handlers: {
      POST: ({ request }) => handleImagineGenerate(request),
    },
  },
});
