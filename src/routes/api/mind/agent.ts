import { createFileRoute } from "@tanstack/react-router";
import { handleAgentRun } from "@/lib/mind/agent-run.server";

export const Route = createFileRoute("/api/mind/agent")({
  server: {
    handlers: {
      POST: ({ request }) => handleAgentRun(request),
    },
  },
});
