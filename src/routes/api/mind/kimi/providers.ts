import { createFileRoute } from "@tanstack/react-router";
import { handleKimiProviders } from "@/lib/mind/kimi/phase4.server";

export const Route = createFileRoute("/api/mind/kimi/providers")({
  server: { handlers: { GET: ({ request }) => handleKimiProviders(request), POST: ({ request }) => handleKimiProviders(request) } },
});
