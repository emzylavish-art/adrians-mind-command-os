import type { Sql } from "../../db.ts";
import { fileRevision, reviewedFileMatches } from "./file-revision.ts";

export const machineRequired = "Connect your paired PC for this operation. The shared server has no isolated coding process for this account.";

export function accountFilePath(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 1000 || input.includes("\0")) return null;
  const path = input.replaceAll("\\", "/");
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")) return null;
  if (/(^|\/)\.env($|\.)|(^|\/)credentials?\.(json|txt|pem)$/i.test(path)) return null;
  return path;
}
function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export type AccountFileRequest = {
  operation?: unknown; path?: unknown; content?: unknown; query?: unknown; to?: unknown;
  confirm?: unknown; expectedMissing?: unknown; expectedContent?: unknown; expectedRevision?: unknown;
  cursor?: unknown; directory?: unknown;
};
export async function accountFileOperation(sql: Sql, owner: string, body: AccountFileRequest): Promise<Response> {
  const operation = body.operation;
  if (operation === "list" || operation === "search") {
    const search = operation === "search";
    const query = typeof body.query === "string" ? body.query.slice(0, 200) : "";
    if (search && !query) return response({ ok: false, error: "Enter a search term." }, 400);
    const cursor = typeof body.cursor === "string" ? accountFilePath(body.cursor) : "";
    const directory = typeof body.directory === "string" && body.directory ? accountFilePath(body.directory.replace(/\/$/, "")) : "";
    if (cursor === null || directory === null) return response({ ok: false, error: "Invalid file page or directory." }, 400);
    const limit = search ? 100 : 200;
    const where = "user_id=$1 and ($2='' or strpos(lower(path), lower($2))>0 or strpos(lower(text_copy),lower($2))>0) and ($3='' or starts_with(path,$3))";
    const params = [owner, search ? query : "", directory ? directory + "/" : ""];
    const rows = await sql.query<{ path: string; bytes: number }>(`select path,bytes from mind_kimi_file where ${where} and path>$4 order by path limit $5`, [...params, cursor, limit + 1]);
    const [{ total }] = await sql.query<{ total: number }>(`select count(*)::int as total from mind_kimi_file where ${where}`, params);
    const page = rows.slice(0, limit);
    const visible = page.filter((row) => accountFilePath(row.path));
    const nextCursor = rows.length > limit ? page.at(-1)?.path : undefined;
    const result = { ...(search ? { matches: visible } : { files: visible }), total, truncated: Boolean(nextCursor), nextCursor, directory: directory || "" };
    return response({ ok: true, ...result, result });
  }
  if (!["read", "write", "rename", "delete"].includes(String(operation))) return response({ ok: false, error: machineRequired }, 409);
  const path = accountFilePath(body.path);
  if (!path) return response({ ok: false, error: "Choose a file inside your workspace." }, 400);
  const missing = () => response({ ok: false, error: "File was not found in your workspace." }, 404);
  const conflict = () => response({ ok: false, code: "revision_conflict", error: "The file changed or its reviewed revision is missing. Read the current copy and review the action again." }, 409);
  if (operation === "read") {
    const [row] = await sql.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id = $1 and path = $2", [owner, path]);
    if (!row) return missing();
    const result = { path, content: row.text_copy, revision: fileRevision(row.text_copy) };
    return response({ ok: true, ...result, result });
  }
  if (!sql.transaction) return response({ ok: false, error: "Account storage is unavailable." }, 503);
  if (operation === "write") {
    const content = body.content;
    if (typeof content !== "string" || content.length > 1_000_000) return response({ ok: false, error: "Enter up to 1,000,000 characters." }, 400);
    if (body.expectedMissing !== true && typeof body.expectedContent !== "string" && typeof body.expectedRevision !== "string") return conflict();
    return sql.transaction(async (tx) => {
      if (body.expectedMissing === true) {
        const inserted = await tx.query("insert into mind_kimi_file (user_id, path, text_copy, bytes) values ($1,$2,$3,$4) on conflict do nothing returning path", [owner, path, content, Buffer.byteLength(content)]);
        if (!inserted.length) return conflict();
        const result = { path, before: "", after: content, revision: fileRevision(content) };
        return response({ ok: true, ...result, result });
      }
      const [current] = await tx.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id=$1 and path=$2 for update", [owner, path]);
      if (!current || !reviewedFileMatches(current.text_copy, body)) return conflict();
      await tx.query("update mind_kimi_file set text_copy=$3, bytes=$4, updated_at=now() where user_id=$1 and path=$2", [owner, path, content, Buffer.byteLength(content)]);
      const result = { path, before: current.text_copy, after: content, revision: fileRevision(content) };
      return response({ ok: true, ...result, result });
    });
  }
  if (body.confirm !== true) return response({ ok: false, error: "Confirm the file change." }, 400);
  try {
    return await sql.transaction(async (tx) => {
      const [current] = await tx.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id=$1 and path=$2 for update", [owner, path]);
      if (!current) return missing();
      if (typeof body.expectedRevision !== "string" || !reviewedFileMatches(current.text_copy, body)) return conflict();
      if (operation === "rename") {
        const to = accountFilePath(body.to);
        if (!to) return response({ ok: false, error: "Choose a destination inside your workspace." }, 400);
        await tx.query("update mind_kimi_file set path=$3, updated_at=now() where user_id=$1 and path=$2", [owner, path, to]);
        return response({ ok: true, path, to, revision: fileRevision(current.text_copy) });
      }
      await tx.query("delete from mind_kimi_file where user_id=$1 and path=$2", [owner, path]);
      return response({ ok: true, path });
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return response({ ok: false, error: "The destination file already exists." }, 409);
    throw error;
  }
}
