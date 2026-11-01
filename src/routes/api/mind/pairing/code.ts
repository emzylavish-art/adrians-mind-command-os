import { createFileRoute } from "@tanstack/react-router";
import { handleMintPairingCode } from "@/lib/mind/pairing/pairing.server";

export const Route = createFileRoute("/api/mind/pairing/code")({
  server: {
    handlers: {
      POST: ({ request }) => handleMintPairingCode(request),
    },
  },
});
