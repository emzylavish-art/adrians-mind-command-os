import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/mind/dashboard-3d/dashboard-page";

function MindDashboard() {
  return (
    <>
      <a
        href="/dashboard/youtube"
        style={{
          position: "fixed",
          zIndex: 1000,
          right: 16,
          bottom: 16,
          padding: "10px 14px",
          borderRadius: 10,
          color: "#f8fafc",
          background: "#b91c1c",
          border: "1px solid rgba(255,255,255,.2)",
          font: "600 12px system-ui",
          textDecoration: "none",
          boxShadow: "0 8px 30px rgba(0,0,0,.35)",
        }}
      >
        YouTube Command Center ↗
      </a>
      <DashboardPage />
    </>
  );
}

/**
 * Adrian's Mind primary command surface: the interactive 3D fleet and knowledge graph.
 * The YouTube creator workspace lives at /dashboard/youtube and remains a separate module.
 */
export const Route = createFileRoute("/dashboard")({
  component: MindDashboard,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · 3D Command Dashboard" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "Interactive 3D command dashboard for Adrian's Mind." },
    ],
  }),
});
