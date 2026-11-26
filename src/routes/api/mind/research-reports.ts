import { createFileRoute } from "@tanstack/react-router";
import { handleResearchLibrary } from "@/lib/mind/research-http.server";
export const Route = createFileRoute("/api/mind/research-reports")({ server: { handlers: {
  GET: ({ request }) => handleResearchLibrary(request),
  PATCH: ({ request }) => handleResearchLibrary(request),
  DELETE: ({ request }) => handleResearchLibrary(request),
} } });
