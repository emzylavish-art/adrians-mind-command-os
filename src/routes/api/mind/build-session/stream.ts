import { createFileRoute } from "@tanstack/react-router";
import { handleBuildSessionStream } from "@/lib/mind/build-session.server";

export const Route = createFileRoute("/api/mind/build-session/stream")({
  server: {
    handlers: {
      GET: ({ request }) => handleBuildSessionStream(request),
    },
  },
});
