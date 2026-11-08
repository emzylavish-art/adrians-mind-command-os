import { createFileRoute } from "@tanstack/react-router";
import { YouTubeCommandCenter } from "@/components/mind/youtube/youtube-command-center";

/** YouTube creator workspace, kept separate from the primary 3D command dashboard. */
export const Route = createFileRoute("/dashboard/youtube")({
  component: YouTubeCommandCenter,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · YouTube Channel Command Center" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "YouTube channel analytics and creator command center." },
    ],
  }),
});
