import { requireUserId } from "../auth/verify.server.ts";
import { assertSameOrigin } from "./connectors/oauth-csrf.ts";
import { readJsonObjectBody } from "./request-body.ts";
import { editResearchMetadata, listResearchReports, readResearchReport, researchVersions } from "./research-library.server.ts";
import { withFailureEnvelope } from "./failure-envelope.ts";

export async function handleResearchLibrary(request: Request): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(withFailureEnvelope(value, { subsystem: "research", status, operationKind: request.method === "GET" ? "read" : "write" }), { status, headers: { "cache-control": "no-store" } });
  let owner: string;
  try { owner = await requireUserId(request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]); }
  catch { return json({ ok: false, error: "Sign in is required." }, 401); }
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const reportId = url.searchParams.get("id");
      if (reportId) {
        const report = await readResearchReport(owner, reportId);
        if (!report) return json({ ok: false, error: "Research report not found." }, 404);
        return json({ ok: true, report, versions: await researchVersions(owner, reportId) });
      }
      return json({ ok: true, ...await listResearchReports(owner, { query: url.searchParams.get("q") ?? undefined, tag: url.searchParams.get("tag") ?? undefined, projectId: url.searchParams.get("project") ?? undefined, archived: url.searchParams.get("archived") === "1", before: url.searchParams.get("before") ?? undefined }) });
    }
    const origin = assertSameOrigin(request);
    if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
    if (request.method !== "PATCH" && request.method !== "DELETE") return json({ ok: false, error: "Method not allowed." }, 405);
    const body = await readJsonObjectBody(request, 12_000);
    if (!body.ok) return json({ ok: false, error: body.error }, body.status);
    if (typeof body.body.reportId !== "string") return json({ ok: false, error: "Report identity is required." }, 400);
    return json({ ok: true, ...await editResearchMetadata(owner, body.body.reportId, body.body.expectedRevision as number, { tags: body.body.tags, projectId: body.body.projectId, archived: body.body.archived, delete: request.method === "DELETE" }) });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Research storage is unavailable." }, 409); }
}
