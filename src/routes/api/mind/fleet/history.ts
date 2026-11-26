import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { clearFinishedRuns } from "@/lib/mind/fleet";
import { updateOwnerWorkspace } from "@/lib/mind/store";

function reply(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }

export const Route = createFileRoute("/api/mind/fleet/history")({ server: { handlers: { POST: async ({ request }) => {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
  const authorization = request.headers.get("authorization");
  let owner: string;
  try { owner = await requireUserId(authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined); }
  catch { return reply({ ok: false, error: "Sign in is required." }, 401); }
  try {
    const raw = await request.text();
    if (raw.length > 25_000) return reply({ ok: false, error: "The selected history is too large." }, 413);
    const body = JSON.parse(raw) as { confirm?: string; runIds?: unknown };
    if (body.confirm !== "delete-finished-run-history" || !Array.isArray(body.runIds) || body.runIds.length > 200 || body.runIds.some(id => typeof id !== "string")) return reply({ ok: false, error: "Confirm the exact finished run records to delete." }, 400);
    const ids = body.runIds as string[];
    const removedIds = await updateOwnerWorkspace(await getSql(), owner, current => {
      const workspace = clearFinishedRuns(current, ids);
      const remaining = new Set(workspace.runs.map(run => run.id));
      return { workspace, result: current.runs.filter(run => !remaining.has(run.id)).map(run => run.id) };
    });
    return reply({ ok: true, removedIds });
  } catch { return reply({ ok: false, error: "History deletion was not confirmed. Refresh the saved history before trying again." }, 503); }
} } } });
