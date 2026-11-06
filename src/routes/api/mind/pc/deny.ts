import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { denyPcApproval, PcApprovalStorageUnavailableError } from "@/lib/mind/pc-pairing/approvals";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/deny")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const originCheck = assertSameOrigin(request);
          if (!originCheck.ok) return json({ ok: false, error: "Forbidden: cross-site request blocked", code: "FORBIDDEN_CROSS_SITE" }, 403);
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const body = (await request.json().catch(() => ({}))) as { approvalId?: string; token?: string };
          const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
          const token = typeof body.token === "string" ? body.token : "";
          if (!approvalId || !token) {
            return json({ ok: false, error: "approvalId and token are required." }, 400);
          }
          const denied = denyPcApproval({ ownerId: userId, approvalId, token });
          if (!denied.ok) {
            return json({ ok: false, error: denied.error }, 403);
          }
          return json({ ok: true, status: "denied", approvalId });
        } catch (error) {
          if (error instanceof Error && error.message === "Unauthorized") return json({ ok: false, error: "Sign in is required." }, 401);
          if (error instanceof PcApprovalStorageUnavailableError) return json({ ok: false, error: "PC approval storage is unavailable. The approval action could not be completed safely.", code: "APPROVAL_STORAGE_UNAVAILABLE" }, 503);
          return json({ ok: false, error: "The approval action could not be completed safely." }, 500);
        }
      },
    },
  },
});
