import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getSql } from "../../db.ts";

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
    await sql.query("update mind_kimi_file set path = $3, updated_at = now() where user_id = $1 and path = $2", [userId, source, dest]);
    return true;
  } catch {
    return false;
  }
}

export async function restoreWorkspaceFiles(userId: string, root: string): Promise<number> {
  if (!userId) return 0;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ path: string; text_copy: string }>("select path, text_copy from mind_kimi_file where user_id = $1", [userId]);
    let count = 0;
    for (const row of rows) {
      const clean = safePath(row.path);
      if (!clean || typeof row.text_copy !== "string") continue;
      const target = resolve(root, clean);
      if (target !== root && !target.startsWith(`${root}/`)) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, row.text_copy);
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}
