import { createFileRoute } from "@tanstack/react-router";
import {
  decideUpdate,
  publicManifest,
  publishedManifest,
  readCloudManifest,
  updateNote,
} from "@/lib/mind/desktop-update";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-frame-options": "DENY",
      "access-control-allow-origin": "*",
    },
  });
}

export const Route = createFileRoute("/api/mind/desktop-update")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const local = publicManifest(publishedManifest);
        const check = new URL(request.url).searchParams.get("check");
        if (check !== "cloud") return json(local);
        const cloud = await readCloudManifest();
        const decision = decideUpdate(local.build, cloud);
        return json({
          ...local,
          cloud,
          decision,
          note: updateNote(local.build, cloud, decision),
        });
      },
    },
  },
});
