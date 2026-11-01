import { createFileRoute } from "@tanstack/react-router";
import { buildSignedAgentManifest } from "@/lib/mind/pairing/manifest.server";
import { verifyAgentFiles, type AgentManifest } from "@/lib/mind/pairing/integrity.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/mind/pairing/manifest")({
  server: {
    handlers: {
      GET: () => {
        const signed = buildSignedAgentManifest();
        if (!signed.ok) return json(signed, 503);
        return json({ ok: true, manifest: signed.manifest });
      },
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("op") !== "verify") {
          return json({ ok: false, error: "Use op=verify." }, 400);
        }
        let body: { manifest?: AgentManifest; localFiles?: Record<string, string> } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "Invalid JSON." }, 400);
        }
        if (!body.manifest || !body.localFiles) {
          return json({ ok: false, error: "manifest and localFiles required." }, 400);
        }
        const result = verifyAgentFiles(body.localFiles, body.manifest, { requireSignature: true });
        if (!result.ok) return json(result, 400);
        return json({ ok: true });
      },
    },
  },
});
