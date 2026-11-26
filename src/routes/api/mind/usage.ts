import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { readUsageLedger } from "@/lib/mind/usage-ledger.server";

export async function usageHistory(request: Request): Promise<Response> {
  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    const owner = await requireUserId(bearer);
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const result = await readUsageLedger(await getSql(), owner, {
      offset: Number.isSafeInteger(offset) ? offset : 0, limit: 500,
      from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined,
    });
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ ok: false, error: "Usage history is unavailable. Sign in and try again." }, { status: 503, headers: { "cache-control": "no-store" } }); }
}

export const Route = createFileRoute("/api/mind/usage")({ server: { handlers: { GET: ({ request }) => usageHistory(request) } } });
