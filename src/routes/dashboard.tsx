import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/mind/dashboard-3d/dashboard-page";

/**
 * Adrian's Mind primary command surface: the interactive 3D fleet and knowledge graph.
 * The YouTube creator workspace lives at /dashboard/youtube and remains a separate module.
 */
export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · 3D Command Dashboard" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "Interactive 3D command dashboard for Adrian's Mind." },
    ],
  }),
});
