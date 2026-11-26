import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { allowMindRequest } from "@/lib/mind/limits";
import { readHaltState } from "@/lib/mind/halt.server";
import { runExternalFleetStep } from "@/lib/mind/fleet-external";
import { executeConnectedFleetStep } from "@/lib/mind/fleet-connected-adapters.server";

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/mind/fleet/execute")({
  server: { handlers: { POST: async ({ request }) => {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
    const authorization = request.headers.get("authorization");
    let owner: string;
    try { owner = await requireUserId(authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined); }
    catch { return reply({ ok: false, error: "Sign in is required." }, 401); }
    if (!allowMindRequest("fleet_external", owner, 6)) return reply({ ok: false, error: "Too many connected execution requests. Wait before trying again." }, 429);
    let input: { runId: string; approvalId: string };
    try {
      const raw = await request.text();
      if (raw.length > 2000) return reply({ ok: false, error: "The execution request is too large." }, 413);
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object" || !("runId" in data) || !("approvalId" in data) || typeof data.runId !== "string" || typeof data.approvalId !== "string") return reply({ ok: false, error: "A saved run and exact authorization are required." }, 400);
      input = { runId: data.runId, approvalId: data.approvalId };
    } catch { return reply({ ok: false, error: "Invalid execution input." }, 400); }
    try {
      const result = await runExternalFleetStep(await getSql(), owner, input, { stop: () => readHaltState(owner), execute: operation => executeConnectedFleetStep(owner, operation) });
      return reply(result, result.ok ? 200 : 409);
    } catch { return reply({ ok: false, error: "The execution receipt could not be read or saved. Check the run before any replacement; no automatic retry will occur." }, 503); }
  } } },
});
