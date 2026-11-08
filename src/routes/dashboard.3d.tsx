import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/mind/dashboard-3d/dashboard-page";

/** Original 3D fleet and knowledge graph, retained as a dedicated dashboard view. */
export const Route = createFileRoute("/dashboard/3d")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · 3D Fleet Map" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "Interactive 3D fleet and knowledge graph." },
    ],
  }),
});
