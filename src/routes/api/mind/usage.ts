import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { getSql } from "@/lib/db";
import { deleteUsageBefore, previewUsageRetention, readUsageLedger } from "@/lib/mind/usage-ledger.server";
import { usageRetentionCutoff } from "@/lib/mind/usage-ledger";
import { readJsonObjectBody } from "@/lib/mind/request-body";
import { decideRequestIsolation } from "@/lib/mind/request-guard";

export async function usageHistory(request: Request): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  if (request.method !== "GET" && request.method !== "DELETE") return reply({ ok: false, error: "Method not allowed." }, 405);
  if (decideRequestIsolation(request) === "block") return reply({ ok: false, error: "Cross-site usage requests are blocked." }, 403);
  try {
    const authorization = request.headers.get("authorization");
    const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
    const owner = await requireUserId(bearer);
    const url = new URL(request.url);
    if (request.method === "DELETE") {
      const body = await readJsonObjectBody(request, 2_000);
      if (!body.ok) return reply({ ok: false, error: body.error }, body.status);
      if (body.body.ownerId !== owner) return reply({ ok: false, error: "The account changed. Review retention again for the current account." }, 403);
      const before = usageRetentionCutoff(body.body.before);
      if (!before || body.body.confirmation !== `DELETE_USAGE_BEFORE:${before}`) return reply({ ok: false, error: "Confirm the exact valid UTC cutoff before deleting saved receipts." }, 400);
      return reply({ ok: true, ...await deleteUsageBefore(await getSql(), owner, String(body.body.before), String(body.body.confirmation)) });
    }
    const expectedOwner = url.searchParams.get("ownerId");
    if (expectedOwner !== null && expectedOwner !== owner) return reply({ ok: false, error: "The account changed. Reload usage for the current account." }, 403);
    const retentionBefore = url.searchParams.get("retentionBefore");
    if (retentionBefore !== null) {
      if (!usageRetentionCutoff(retentionBefore)) return reply({ ok: false, error: "Choose a valid UTC cutoff date that is not in the future." }, 400);
      return reply({ ok: true, ...await previewUsageRetention(await getSql(), owner, retentionBefore) });
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 500);
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (from && !Number.isFinite(Date.parse(from)) || to && !Number.isFinite(Date.parse(to)) || from && to && Date.parse(from) > Date.parse(to)) return reply({ ok: false, error: "Choose a valid usage period." }, 400);
    const result = await readUsageLedger(await getSql(), owner, {
      offset: Number.isSafeInteger(offset) ? offset : 0, limit: Number.isSafeInteger(limit) ? limit : 500,
      from: from ?? undefined, to: to ?? undefined,
    });
    return reply({ ok: true, ...result });
  } catch { return reply({ ok: false, error: "Usage storage is unavailable. Reload history or review retention before retrying." }, 503); }
}

export const Route = createFileRoute("/api/mind/usage")({ server: { handlers: { GET: ({ request }) => usageHistory(request), DELETE: ({ request }) => usageHistory(request) } } });
