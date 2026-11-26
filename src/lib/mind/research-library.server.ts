import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import type { ResearchResult } from "./research.ts";

export type SavedResearch = { reportId: string; revision: number; question: string; result: ResearchResult; tags: string[]; projectId: string | null; archived: boolean; createdAt: string; updatedAt: string };
async function database(db?: Sql) { return db ?? (await import("../db.ts")).getSql(); }
function mapReport(row: Record<string, unknown>): SavedResearch {
  const time = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
  return { reportId: String(row.report_id), revision: Number(row.revision), question: String(row.question), result: { ...(row.result as ResearchResult), persistence: { saved: true, reportId: String(row.report_id), revision: Number(row.revision) } }, tags: row.tags as string[], projectId: row.project_id as string | null, archived: row.archived === true, createdAt: time(row.created_at), updatedAt: time(row.updated_at) };
}
export async function readResearchReport(owner: string, reportId: string, db?: Sql): Promise<SavedResearch | null> {
  const sql = await database(db);
  const rows = await sql.query<Record<string, unknown>>("select * from mind_research_report where owner_id=$1 and report_id=$2", [owner, reportId]);
  return rows[0] ? mapReport(rows[0]) : null;
}
export async function listResearchReports(owner: string, input: { query?: string; projectId?: string; tag?: string; archived?: boolean; before?: string; limit?: number } = {}, db?: Sql) {
  const sql = await database(db);
  const count = Math.max(1, Math.min(50, Number.isSafeInteger(input.limit) ? input.limit! : 25));
  const split = input.before?.lastIndexOf("|") ?? -1;
  const cursorDate = split > 0 ? input.before!.slice(0, split) : null;
  const cursorId = split > 0 ? input.before!.slice(split + 1) : "";
  if (input.before && (!cursorDate || !Number.isFinite(Date.parse(cursorDate)) || !cursorId)) throw new Error("Invalid research page cursor.");
  const rows = await sql.query<Record<string, unknown>>(`select * from mind_research_report where owner_id=$1 and archived=$2
    and ($3='' or position(lower($3) in lower(question))>0)
    and ($4='' or project_id=$4) and ($5='' or tags @> $6::jsonb)
    and ($7::timestamptz is null or (updated_at, report_id) < ($7::timestamptz, $8))
    order by updated_at desc, report_id desc limit $9`, [owner, input.archived === true, (input.query ?? "").slice(0, 300), input.projectId ?? "", input.tag ?? "", JSON.stringify(input.tag ? [input.tag] : []), cursorDate, cursorId, count + 1]);
  const items = rows.slice(0, count).map(mapReport);
  const last = rows[count - 1];
  return { items, nextCursor: rows.length > count && last ? `${last.updated_at instanceof Date ? last.updated_at.toISOString() : last.updated_at}|${last.report_id}` : null };
}
export async function saveResearchReport(owner: string, input: { question: string; result: ResearchResult; reportId?: string; expectedRevision?: number; tags?: string[]; projectId?: string | null }, db?: Sql) {
  const sql = await database(db);
  if (!sql.transaction) throw new Error("Atomic research storage is unavailable.");
  if (!input.question.trim() || input.question.length > 300 || JSON.stringify(input.result).length > 200_000) throw new Error("The research report exceeds its storage limits.");
  const reportId = input.reportId ?? randomUUID();
  const tags = [...new Set((input.tags ?? []).filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  return sql.transaction(async (tx) => {
    let revision = 1;
    if (input.reportId) {
      const rows = await tx.query<{ revision: number }>("update mind_research_report set result=$4::jsonb, revision=revision+1, updated_at=now() where owner_id=$1 and report_id=$2 and revision=$3 and archived=false returning revision", [owner, reportId, input.expectedRevision, JSON.stringify(input.result)]);
      if (!rows[0]) throw new Error("The report changed, was archived, or is unavailable. Reload it before saving.");
      revision = rows[0].revision;
    } else await tx.query("insert into mind_research_report(owner_id,report_id,revision,question,tags,project_id,result) values($1,$2,1,$3,$4::jsonb,$5,$6::jsonb)", [owner, reportId, input.question.trim(), JSON.stringify(tags), input.projectId?.slice(0, 100) ?? null, JSON.stringify(input.result)]);
    await tx.query("insert into mind_research_report_version(owner_id,report_id,revision,result) values($1,$2,$3,$4::jsonb)", [owner, reportId, revision, JSON.stringify(input.result)]);
    return { reportId, revision };
  });
}
export async function researchVersions(owner: string, reportId: string, db?: Sql) {
  return (await database(db)).query("select revision,result,created_at from mind_research_report_version where owner_id=$1 and report_id=$2 order by revision desc limit 50", [owner, reportId]);
}
export async function editResearchMetadata(owner: string, reportId: string, expectedRevision: number, input: { tags?: unknown; projectId?: unknown; archived?: unknown; delete?: unknown }, db?: Sql) {
  const sql = await database(db);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("A current report revision is required.");
  if (input.delete === true) {
    const rows = await sql.query("delete from mind_research_report where owner_id=$1 and report_id=$2 and revision=$3 returning report_id", [owner, reportId, expectedRevision]);
    if (!rows.length) throw new Error("The report changed or is unavailable. Reload before deleting.");
    return { deleted: true };
  }
  if (input.archived !== undefined && typeof input.archived !== "boolean") throw new Error("Archive state must be boolean.");
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string" || tag.length > 40) || input.tags.length > 12)) throw new Error("Use up to twelve tags of forty characters.");
  if (input.projectId !== undefined && input.projectId !== null && (typeof input.projectId !== "string" || input.projectId.length > 100)) throw new Error("Invalid project identity.");
  const rows = await sql.query<{ revision: number }>("update mind_research_report set tags=coalesce($4::jsonb,tags), project_id=case when $5 then $6 else project_id end, archived=coalesce($7,archived), revision=revision+1, updated_at=now() where owner_id=$1 and report_id=$2 and revision=$3 returning revision", [owner, reportId, expectedRevision, input.tags === undefined ? null : JSON.stringify(input.tags), input.projectId !== undefined, input.projectId ?? null, input.archived ?? null]);
  if (!rows[0]) throw new Error("The report changed or is unavailable. Reload before editing.");
  return { revision: rows[0].revision };
}
