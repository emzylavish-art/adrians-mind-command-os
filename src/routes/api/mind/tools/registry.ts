import { createFileRoute } from "@tanstack/react-router";
import { loadToolsPagePayload } from "@/lib/mind/tools-registry/load-registry";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Public read of the gated tool registry view.
 * Callable MCP tools come from tool-catalog.ts; GitHub inventory from tools/registry.json
 * with BlackEye/L1B3RT4S stripped and unverified GitHub sources marked not callable.
 */
export const Route = createFileRoute("/api/mind/tools/registry")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = loadToolsPagePayload();
          return json({ ok: true, ...payload });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Registry load failed.";
          return json({ ok: false, error: message }, 500);
        }
      },
    },
  },
});
