import { createFileRoute } from "@tanstack/react-router";
import { handleKimiProjects } from "@/lib/mind/kimi/phase4.server";

export const Route = createFileRoute("/api/mind/build/projects")({
  server: { handlers: { GET: ({ request }) => handleKimiProjects(request), POST: ({ request }) => handleKimiProjects(request) } },
});
