import { createFileRoute } from "@tanstack/react-router";
import { handleKimiFiles } from "@/lib/mind/kimi/files.server";

export const Route = createFileRoute("/api/mind/build/files")({
  server: {
    handlers: {
      GET: ({ request }) => handleKimiFiles(request),
      POST: ({ request }) => handleKimiFiles(request),
    },
  },
});
