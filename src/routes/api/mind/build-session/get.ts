import { createFileRoute } from "@tanstack/react-router";
import { handleBuildSessionGet } from "@/lib/mind/build-session.server";

export const Route = createFileRoute("/api/mind/build-session/get")({
  server: {
    handlers: {
      GET: ({ request }) => handleBuildSessionGet(request),
    },
  },
});
