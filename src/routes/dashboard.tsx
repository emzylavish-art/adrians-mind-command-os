import { createFileRoute } from "@tanstack/react-router";
import { AgentCommandCenter } from "@/components/mind/agent-command-center";

/** Public read-only dashboard. Account-scoped connections remain inside the signed-in workspace. */
export const Route = createFileRoute("/dashboard")({
  component: AgentCommandCenter,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Dashboard" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "Your connected workspaces and the public operations dashboard." },
    ],
  }),
});
