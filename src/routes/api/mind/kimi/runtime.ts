import { createFileRoute } from "@tanstack/react-router";
import { handleKimiRuntime } from "@/lib/mind/kimi/hosted/runtime.server";

export const Route = createFileRoute("/api/mind/kimi/runtime")({
  server: { handlers: { GET: ({ request }) => handleKimiRuntime(request), POST: ({ request }) => handleKimiRuntime(request) } },
});
