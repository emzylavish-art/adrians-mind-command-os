import { createFileRoute } from "@tanstack/react-router";
import { handleKimiVoice } from "@/lib/mind/kimi/phase4.server";

export const Route = createFileRoute("/api/mind/build/voice")({
  server: { handlers: { POST: ({ request }) => handleKimiVoice(request) } },
});
