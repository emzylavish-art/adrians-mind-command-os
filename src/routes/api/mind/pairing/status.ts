import { createFileRoute } from "@tanstack/react-router";
import { handlePairingStatus } from "@/lib/mind/pairing/pairing.server";

export const Route = createFileRoute("/api/mind/pairing/status")({
  server: {
    handlers: {
      GET: ({ request }) => handlePairingStatus(request),
    },
  },
});
