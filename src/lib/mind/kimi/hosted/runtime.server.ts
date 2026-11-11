import { requireUserId } from "../../../auth/verify.server";
import { assertSameOrigin } from "../../connectors/oauth-csrf";
import { probeKimiAcp } from "./acp-client.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export async function handleKimiRuntime(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  if (request.method === "POST") {
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
  }
  try {
    await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {
    return json({ ok: false, error: "Sign in is required." }, 401);
  }
  const probe = await probeKimiAcp(process.env.KIMI_BIN || "kimi");
  const created = probe.status === "session_created";
  return json({
    ok: created || probe.status === "authentication_required",
    status: probe.status === "authentication_required" ? "BLOCKED" : created ? "PARTIAL" : "NOT_CONFIGURED",
    probe,
    sessionCreated: created,
    taskCompleted: false,
    note: created
      ? "A Kimi session was created. No coding task has been accepted yet."
      : "No coding task was run. Authentication or runtime configuration is still missing.",
  }, probe.status === "not_configured" || probe.status === "failed" ? 503 : 200);
}
