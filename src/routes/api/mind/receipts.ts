import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "../../../lib/auth/verify.server.ts";
import { assertSameOrigin } from "../../../lib/mind/connectors/oauth-csrf.ts";
import { listReceipts, recordReceipt } from "../../../lib/mind/receipts.server.ts";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/mind/receipts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const same = assertSameOrigin(request);
        if (!same.ok) return json({ ok: false, error: same.error }, 403);
        const userId = await requireUserId(request);
        const body = (await request.json().catch(() => ({}))) as { operation?: string; state?: string; action?: string; detail?: string };
        if (body.operation === "list") {
          const receipts = await listReceipts(userId);
          return json({ ok: true, receipts });
        }
        const state = body.state === "EXECUTED" ? "EXECUTED" : body.state === "PROPOSED" ? "PROPOSED" : null;
        const action = (body.action || "").trim();
        if (!state || !action) return json({ ok: false, error: "A receipt needs a state and an action. Nothing was recorded." }, 400);
        const receipt = await recordReceipt(userId, { state, action, detail: body.detail || "" });
        return json({ ok: true, receipt });
      },
    },
  },
});
