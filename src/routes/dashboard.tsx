import { createFileRoute } from "@tanstack/react-router";
import { YouTubeCommandCenter } from "@/components/mind/youtube/youtube-command-center";

/**
 * Primary production experience: YouTube Channel Command Center.
 * Channel metrics remain explicitly marked as demonstration data until OAuth
 * and YouTube API access have been completed for the channel owner.
 */
export const Route = createFileRoute("/dashboard")({
  component: YouTubeCommandCenter,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · YouTube Channel Command Center" },
      { name: "theme-color", content: "#080d14" },
      { name: "description", content: "YouTube channel analytics and creator command center." },
    ],
  }),
});
