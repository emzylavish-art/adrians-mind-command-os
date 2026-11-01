import { createFileRoute } from "@tanstack/react-router";
import {
  handleSignAction,
  handleVerifyAction,
  handleReportAction,
  handleRotateToken,
} from "@/lib/mind/pairing/pairing.server";

export const Route = createFileRoute("/api/mind/pairing/action")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const op = url.searchParams.get("op") || "sign";
        if (op === "verify") return handleVerifyAction(request);
        if (op === "report") return handleReportAction(request);
        if (op === "rotate") return handleRotateToken(request);
        return handleSignAction(request);
      },
    },
  },
});
