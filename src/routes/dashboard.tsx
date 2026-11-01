import { createFileRoute } from "@tanstack/react-router";
import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Mind Dashboard · Adrian's Mind" },
      { name: "theme-color", content: "#070b16" },
    ],
  }),
});

function DashboardPage() {
  return <DashboardApp />;
}
