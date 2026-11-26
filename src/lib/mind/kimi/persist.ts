import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getSql, type Sql } from "../../db.ts";

const SECRET = /(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i;

function safePath(path: string): string | null {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => part === ".." || part === ".git") || SECRET.test(clean)) return null;
  return clean;
}

export async function recordKimiAttempt(input: { ownerId: string; status: string; error?: string }): Promise<boolean> {
  try {
    const sql = await getSql();
    const id = randomBytes(8).toString("hex");
    await sql.query(
      "insert into mind_kimi_session (user_id, id, title, status) values ($1, $2, $3, $4)",
      [input.ownerId, id, (input.error || "").slice(0, 180), input.status.slice(0, 40)],
    );
    return true;
  } catch {
    return false;
  }
}

export async function saveWorkspaceFile(userId: string, path: string, text: string): Promise<boolean> {
  const clean = safePath(path);
  if (!userId || !clean || text.length > 1_000_000) return false;
  try {
    const sql = await getSql();
    await sql.query(
      `insert into mind_kimi_file (user_id, path, text_copy, bytes, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (user_id, path) do update set text_copy = excluded.text_copy, bytes = excluded.bytes, updated_at = now()`,
      [userId, clean, text, Buffer.byteLength(text)],
    );
    await sql.query(
      `insert into mind_kimi_runtime (user_id, id, target, version, status, updated_at)
       values ($1, 'hosted', 'account-store', 'durable', 'ready', now())
       on conflict (user_id, id) do update set status = 'ready', target = 'account-store', updated_at = now()`,
      [userId],
    );
    return true;
  } catch {
    return false;
  }
}

export async function forgetWorkspaceFile(userId: string, path: string): Promise<boolean> {
  const clean = safePath(path);
  if (!userId || !clean) return false;
  try {
    const sql = await getSql();
    await sql.query("delete from mind_kimi_file where user_id = $1 and path = $2", [userId, clean]);
    return true;
  } catch {
    return false;
  }
}

export async function renameWorkspaceFile(userId: string, from: string, to: string): Promise<boolean> {
  const source = safePath(from);
  const dest = safePath(to);
  if (!userId || !source || !dest) return false;
  try {
    const sql = await getSql();
    const changed = await sql.query("update mind_kimi_file set path = $3, updated_at = now() where user_id = $1 and path = $2 returning path", [userId, source, dest]);
    return changed.length === 1;
  } catch {
    return false;
  }
}

export type WorkspaceRestoreResult = { ok: boolean; restored: string[]; missing: string[]; preserved: string[]; conflicts: string[]; snapshot?: string; error?: string };
/** Explicit recovery only: existing disk content is never overwritten. */
export async function restoreWorkspaceFilesDetailed(userId: string, root: string, suppliedSql?: Sql, applyMissing = true, expectedSnapshot?: string): Promise<WorkspaceRestoreResult> {
  const result: WorkspaceRestoreResult = { ok: true, restored: [], missing: [], preserved: [], conflicts: [] };
  if (!userId) return { ...result, ok: false, error: "Sign in is required." };
  try {
    const sql = suppliedSql ?? await getSql();
    const rows = await sql.query<{ path: string; text_copy: string }>("select path, text_copy from mind_kimi_file where user_id = $1", [userId]);
    result.snapshot = createHash("sha256").update(JSON.stringify(rows.map((row) => [row.path, row.text_copy]).sort((a, b) => a[0].localeCompare(b[0])))).digest("hex");
    if (applyMissing && expectedSnapshot !== undefined && expectedSnapshot !== result.snapshot) return { ...result, ok: false, error: "Account storage changed after review. Review recovery again before restoring." };
    for (const row of rows) {
      const clean = safePath(row.path);
      if (!clean || typeof row.text_copy !== "string") continue;
      const target = resolve(root, clean);
      if (target !== root && !target.startsWith(`${root}/`)) continue;
      const parts = clean.split("/");
      if (parts.some((_, index) => lstatSync(resolve(root, ...parts.slice(0, index + 1)), { throwIfNoEntry: false })?.isSymbolicLink())) { result.conflicts.push(clean); continue; }
      const current = lstatSync(target, { throwIfNoEntry: false });
      if (current) {
        result.preserved.push(clean);
        if (!current.isFile() || readFileSync(target, "utf8") !== row.text_copy) result.conflicts.push(clean);
        continue;
      }
      result.missing.push(clean);
      if (!applyMissing) continue;
      mkdirSync(dirname(target), { recursive: true });
      try { writeFileSync(target, row.text_copy, { flag: "wx" }); result.restored.push(clean); }
      catch (error) {
        if ((error as { code?: string })?.code === "EEXIST") result.conflicts.push(clean);
        else throw error;
      }
    }
    return result;
  } catch { return { ...result, ok: false, error: "Account recovery did not complete. Existing disk files were preserved. Review the reported partial result." }; }
}
export async function restoreWorkspaceFiles(userId: string, root: string, suppliedSql?: Sql): Promise<number> {
  return (await restoreWorkspaceFilesDetailed(userId, root, suppliedSql)).restored.length;
}
