import { createFileRoute } from "@tanstack/react-router";
import { handleIdeTools } from "@/lib/mind/kimi/ide.server";

export const Route = createFileRoute("/api/mind/kimi/ide")({
  server: {
    handlers: {
      POST: ({ request }) => handleIdeTools(request),
    },
  },
});
