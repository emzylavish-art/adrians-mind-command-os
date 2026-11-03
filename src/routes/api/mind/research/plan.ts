import { createFileRoute } from "@tanstack/react-router";
import { handleResearchPlan } from "@/lib/mind/research-session.server";

export const Route = createFileRoute("/api/mind/research/plan")({
  server: {
    handlers: {
      POST: ({ request }) => handleResearchPlan(request),
    },
  },
});
