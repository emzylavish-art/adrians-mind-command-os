import { createFileRoute } from "@tanstack/react-router";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { validateOutcomeBatch } from "@/lib/intent/outcome-validate";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * POST /api/intent/outcomes
 * Signed-in batch pipe into pattern_outcomes (service role on server only).
 */
export const Route = createFileRoute("/api/intent/outcomes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const originCheck = assertSameOrigin(request);
          if (!originCheck.ok) return json({ ok: false, error: originCheck.error }, 403);

          // Dynamic import keeps verify.server / outcomes.server out of any client graph.
          const { requireUserId } = await import("@/lib/auth/verify.server");
          const authorization = request.headers.get("authorization");
          const bearer = authorization?.toLowerCase().startsWith("bearer ")
            ? authorization.slice(7).trim()
            : undefined;
          await requireUserId(bearer);

          const body = await request.json().catch(() => null);
          const validated = validateOutcomeBatch(body);
          if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

          const { insertPatternOutcomes } = await import("@/lib/intent/outcomes.server");
          const result = await insertPatternOutcomes(validated.items);
          if (!result.ok) {
            return json(
              { ok: false, error: result.error, inserted: 0, dropped: validated.items.length },
              503,
            );
          }

          return json({
            ok: true,
            inserted: result.inserted,
            droppedNoPattern: result.droppedNoPattern,
            droppedUnknownPattern: result.droppedUnknownPattern,
            droppedInvalid: validated.droppedInvalid,
            acknowledged: result.acknowledged,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unauthorized";
          if (message === "Unauthorized") {
            return json({ ok: false, error: "Sign in is required." }, 401);
          }
          return json({ ok: false, error: "Unable to record outcomes." }, 500);
        }
      },
    },
  },
});
