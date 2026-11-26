import { createFileRoute } from "@tanstack/react-router";
import { handleScheduleTick } from "@/lib/mind/schedule-tick.server";

export const Route = createFileRoute("/api/mind/schedules/tick")({
  server: { handlers: { POST: ({ request }) => handleScheduleTick(request) } },
});
