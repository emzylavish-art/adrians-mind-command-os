import { createFileRoute } from "@tanstack/react-router";
import { handleMindTurn } from "@/lib/mind/turn.server";

export const Route = createFileRoute("/api/mind/turn")({
  server: {
    handlers: {
      POST: ({ request }) => handleMindTurn(request),
    },
  },
});
