import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { handleSessionIdentity } from "@/lib/auth/session-http";

export const Route = createFileRoute("/api/mind/session")({
  server: { handlers: { GET: ({ request }) => handleSessionIdentity(request, getSessionUser) } },
});
