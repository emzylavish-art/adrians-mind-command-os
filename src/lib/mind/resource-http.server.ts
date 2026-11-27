import { requireUserId } from "../auth/verify.server.ts";
import { decideFetchSite } from "./request-guard.ts";
import { assertSameOrigin } from "./connectors/oauth-csrf.ts";
import { getResourcePolicy, resourceLedger, saveResourcePolicy } from "./resource-governor.server.ts";
import { readJsonObjectBody } from "./request-body.ts";
import { withFailureEnvelope } from "./failure-envelope.ts";

export async function handleResourcePolicy(request: Request): Promise<Response> {
  const respond = (value: unknown, status = 200) => Response.json(withFailureEnvelope(value, { subsystem: "storage", status, operationKind: request.method === "GET" ? "read" : "write" }), { status, headers: { "cache-control": "no-store" } });
  if (decideFetchSite({ site: request.headers.get("sec-fetch-site"), mode: request.headers.get("sec-fetch-mode"), dest: request.headers.get("sec-fetch-dest"), method: request.method }) === "block") return respond({ ok: false, error: "Cross-site request blocked." }, 403);
  let owner: string;
  try {
    const authorization = request.headers.get("authorization");
    owner = await requireUserId(authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : undefined);
  } catch { return respond({ ok: false, error: "Sign in is required." }, 401); }
  try {
    if (request.method === "GET") return respond({ ok: true, ...await getResourcePolicy(owner), operations: await resourceLedger(owner), monetaryEvidence: "Provider token accounting and versioned estimates; not a verified billing statement." });
    if (request.method !== "PUT") return respond({ ok: false, error: "Method not allowed." }, 405);
    const origin = assertSameOrigin(request);
    if (!origin.ok) return respond({ ok: false, error: origin.error }, 403);
    const body = await readJsonObjectBody(request, 50_000);
    if (!body.ok) return respond({ ok: false, error: body.error }, body.status);
    const revision = await saveResourcePolicy(owner, body.body.policy, body.body.expectedRevision as number);
    return respond({ ok: true, revision });
  } catch (error) { return respond({ ok: false, error: error instanceof Error ? error.message : "Resource policy is unavailable." }, 409); }
}
