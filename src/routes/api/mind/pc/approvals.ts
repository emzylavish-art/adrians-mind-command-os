import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { listPendingApprovals, PcApprovalStorageUnavailableError } from "@/lib/mind/pc-pairing/approvals";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/mind/pc/approvals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : undefined;
          const userId = await requireUserId(bearer);
          const approvals = listPendingApprovals(userId);
          return json({
            ok: true,
            approvals: approvals.map((a) => ({
              id: a.id,
              token: a.token,
              command: a.command,
              agentId: a.agentId,
              agentLabel: a.agentLabel,
              createdAt: a.createdAt,
              expiresAt: a.expiresAt,
              status: a.status,
            })),
          });
        } catch (error) {
          if (error instanceof Error && error.message === "Unauthorized") return json({ ok: false, error: "Sign in is required." }, 401);
          if (error instanceof PcApprovalStorageUnavailableError) return json({ ok: false, error: "PC approval storage is unavailable. Pending approvals could not be loaded.", code: "APPROVAL_STORAGE_UNAVAILABLE" }, 503);
          return json({ ok: false, error: "Pending approvals could not be loaded." }, 500);
        }
      },
    },
  },
});
