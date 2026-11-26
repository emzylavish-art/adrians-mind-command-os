import { timingSafeEqual } from "node:crypto";
import type { WorkerPass } from "./worker-pass.ts";

export async function handleScheduleTick(request: Request, deps: {
  token?: string;
  pass?: () => Promise<WorkerPass>;
} = {}): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const expected = deps.token ?? process.env.MIND_SCHEDULE_WORKER_TOKEN;
  if (!expected || expected.length < 32) return json({ ok: false, error: "The hosted schedule worker is not configured." }, 503);
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const left = Buffer.from(expected), right = Buffer.from(provided);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return json({ ok: false, error: "Worker authorization is required." }, 401);
  try {
    const pass = deps.pass || (async () => {
      const { getSql } = await import("../db.ts");
      const { runLocalSchedulePass } = await import("./worker-pass.ts");
      const { readHaltState } = await import("./halt.server.ts");
      const sql = await getSql();
      if (!sql.transaction) throw new Error("Shared execution storage is unavailable.");
      return runLocalSchedulePass(sql, new Date().toISOString(), "hosted-schedule-worker", readHaltState, "hosted-worker");
    });
    return json({ ok: true, execution: "bounded local tools only; model and external operations require separate reviewed execution", summary: await pass() });
  } catch {
    return json({ ok: false, error: "The schedule pass could not be verified. No completion was assumed." }, 503);
  }
}
