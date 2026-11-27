import type { Sql } from "../../db.ts";
import type { VideoJob, VideoJobStore } from "./video-jobs.ts";

function decoded(row: Record<string, unknown>): VideoJob {
  const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
  return { requestHash: typeof row.request_hash === "string" ? row.request_hash : "", projectId: typeof row.project_id === "string" ? row.project_id : "", taskId: typeof row.task_id === "string" ? row.task_id : "", ownerId: String(row.owner_id), operationId: String(row.operation_id), chatId: String(row.chat_id), requestId: String(row.request_id), prompt: String(row.prompt), settings: (typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings) as VideoJob["settings"], state: row.state as VideoJob["state"], model: String(row.model), url: String(row.result_url), error: String(row.error), temporary: row.temporary === true, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), expiresAt: row.expires_at ? iso(row.expires_at) : null };
}

export async function durableVideoJobs(sql?: Sql): Promise<VideoJobStore> {
  const db = sql || await (await import("../../db.ts")).getSql();
  const cleanup = async (owner: string) => { await db.query("delete from mind_media_jobs where owner_id=$1 and expires_at is not null and expires_at<=now()", [owner]); };
  return {
    async claim(job, retryBlocked = false) {
      await cleanup(job.ownerId);
      const rows = await db.query("insert into mind_media_jobs(owner_id,operation_id,chat_id,prompt,settings,state,temporary,expires_at,request_hash,project_id,task_id) values($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) on conflict(owner_id,operation_id) do update set state='submitting',error='',updated_at=now() where $12::boolean and mind_media_jobs.state='blocked' and mind_media_jobs.request_id='' and mind_media_jobs.request_hash=excluded.request_hash and mind_media_jobs.request_hash<>'' returning operation_id", [job.ownerId, job.operationId, job.chatId, job.prompt, JSON.stringify(job.settings), job.state, job.temporary, job.expiresAt, job.requestHash || "", job.projectId || "", job.taskId || job.operationId, retryBlocked]);
      return rows.length === 1;
    },
    async get(owner, id) { await cleanup(owner); const [row] = await db.query<Record<string, unknown>>("select * from mind_media_jobs where owner_id=$1 and operation_id::text=$2", [owner, id]); return row ? decoded(row) : null; },
    async byRequest(owner, id) { await cleanup(owner); const [row] = await db.query<Record<string, unknown>>("select * from mind_media_jobs where owner_id=$1 and request_id=$2", [owner, id]); return row ? decoded(row) : null; },
    async list(owner) { await cleanup(owner); return (await db.query<Record<string, unknown>>("select * from mind_media_jobs where owner_id=$1 order by created_at desc limit 100", [owner])).map(decoded); },
    async save(job) {
      const rows = await db.query("update mind_media_jobs set request_id=$3,state=$4,model=$5,result_url=$6,error=$7,updated_at=$8 where owner_id=$1 and operation_id=$2 returning operation_id", [job.ownerId, job.operationId, job.requestId, job.state, job.model, job.url, job.error, job.updatedAt]);
      if (rows.length !== 1) throw new Error("The media recovery record was not saved. Do not start another generation before reconciling the original request.");
    },
  };
}
