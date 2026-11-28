import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { sessionErrorStatus } from "@/lib/auth/session-resolution";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readDispatchPolicy, saveDispatchPolicy } from "@/lib/mind/dispatch-controls.server";
import { approveFinancialRequest, readFinancialSnapshot, reconcileFinancialInvoice, refreshVerifiedFreePricing, saveFinancialPolicy } from "@/lib/mind/financial-policy.server";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } });
export const Route = createFileRoute("/api/mind/dispatch-policy")({ server: { handlers: {
  GET: async ({ request }) => {
    try {
      const owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
      const query = new URL(request.url).searchParams;
      const expectedOwner = query.get("ownerId");
      if (expectedOwner !== null && expectedOwner !== owner) return reply({ ok: false, error: "The account changed. Reload its monetary evidence." }, 403);
      if (query.get("section") === "financial") return reply({ ok: true, financial: await readFinancialSnapshot(owner) });
      return reply({ ok: true, policy: await readDispatchPolicy(owner) });
    } catch (error) { return reply({ ok: false, error: "Account request limits or monetary evidence could not be read." }, sessionErrorStatus(error)); }
  },
  POST: async ({ request }) => {
    const origin = assertSameOrigin(request); if (!origin.ok) return reply({ ok: false, error: origin.error }, 403);
    try {
      const owner = await requireUserId(request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
      const raw = await request.text(); if (raw.length > 100000) return reply({ ok: false, error: "Policy request is too large." }, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply({ ok: false, error: "Invalid policy." }, 400);
      let result;
      if (body.action === "financial_save") result = await saveFinancialPolicy(owner, body.policy);
      else if (body.action === "financial_approve" && typeof body.id === "string" && typeof body.approve === "boolean") result = await approveFinancialRequest(owner,body.id,body.approve);
      else if (body.action === "financial_reconcile") result = await reconcileFinancialInvoice(owner,body.invoice);
      else if (body.action === "financial_refresh_free") result = await refreshVerifiedFreePricing(owner);
      else if (body.action) return reply({ ok: false, error: "Unsupported financial action." }, 400);
      else result = await saveDispatchPolicy(owner,body);
      return reply(result, result.ok ? 200 : 409);
    } catch (error) { return reply({ ok: false, error: "The account request policy, review or invoice record was not confirmed. Refresh before repeating it." }, sessionErrorStatus(error)); }
  },
} } });
