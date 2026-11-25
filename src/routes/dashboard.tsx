import { createFileRoute } from "@tanstack/react-router";
import { OwnerDashboard } from "@/components/mind/owner-dashboard";

/** Account-scoped dashboard: never put connections or workspaces in a public feed. */
export const Route = createFileRoute("/dashboard")({
  component: OwnerDashboard,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Dashboard" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "Your Adrian's Mind connections and workspaces." },
    ],
  }),
});
