import { createFileRoute } from "@tanstack/react-router";
import { handleCodingBrowser } from "@/lib/mind/kimi/hosted/browser-route.server";

export const Route = createFileRoute("/api/mind/build/browser")({
  server: { handlers: { GET: ({ request }) => handleCodingBrowser(request), POST: ({ request }) => handleCodingBrowser(request), DELETE: ({ request }) => handleCodingBrowser(request) } },
});
