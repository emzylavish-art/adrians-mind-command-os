import { createFileRoute } from "@tanstack/react-router";
import { handleHandshake } from "@/lib/mind/pairing/pairing.server";

export const Route = createFileRoute("/api/mind/pairing/handshake")({
  server: {
    handlers: {
      POST: ({ request }) => handleHandshake(request),
    },
  },
});
