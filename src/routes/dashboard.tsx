import { createFileRoute } from "@tanstack/react-router";
import { AgentCommandCenter } from "@/components/mind/agent-command-center";

/** Public read-only dashboard for Adrian's Mind agent operations. */
export const Route = createFileRoute("/dashboard")({
  component: AgentCommandCenter,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Agent Command Center" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "Live AI agent fleet, task queue, execution timeline, and system health." },
    ],
  }),
});
