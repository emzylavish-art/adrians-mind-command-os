import { createFileRoute } from "@tanstack/react-router";
import { handleKimiCapabilities } from "@/lib/mind/kimi/phase4.server";

export const Route = createFileRoute("/api/mind/kimi/capabilities")({
  server: { handlers: { GET: ({ request }) => handleKimiCapabilities(request) } },
});
