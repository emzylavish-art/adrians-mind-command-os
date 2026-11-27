import { createFileRoute } from "@tanstack/react-router";
import { handleResourcePolicy } from "@/lib/mind/resource-http.server";

export const Route = createFileRoute("/api/mind/resources")({
  server: { handlers: { GET: ({ request }) => handleResourcePolicy(request), PUT: ({ request }) => handleResourcePolicy(request) } },
});
