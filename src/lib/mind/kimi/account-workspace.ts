import type { Sql } from "../../db.ts";

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

export async function accountFileOperation(sql: Sql, owner: string, body: {
  operation?: unknown; path?: unknown; content?: unknown; query?: unknown; to?: unknown;
  confirm?: unknown; expectedMissing?: unknown; expectedContent?: unknown;
}): Promise<Response> {
  const operation = body.operation;
  if (operation === "list" || operation === "search") {
    const search = operation === "search";
    const query = typeof body.query === "string" ? body.query.slice(0, 200) : "";
    if (search && !query) return response({ ok: false, error: "Enter a search term." }, 400);
    const rows = await sql.query<{ path: string; bytes: number }>(
      `select path, bytes from mind_kimi_file where user_id = $1
       and ($2 = '' or strpos(lower(path), lower($2)) > 0 or strpos(lower(text_copy), lower($2)) > 0) order by path`,
      [owner, search ? query : ""],
    );
    const visible = rows.filter((row) => accountFilePath(row.path));
    const result = search ? { matches: visible.slice(0, 100) } : { files: visible.slice(0, 200), total: visible.length, truncated: visible.length > 200 };
    return response({ ok: true, ...result, result });
  }
  if (!["read", "write", "rename", "delete"].includes(String(operation))) return response({ ok: false, error: machineRequired }, 409);
  const path = accountFilePath(body.path);
  if (!path) return response({ ok: false, error: "Choose a file inside your workspace." }, 400);
  const missing = () => response({ ok: false, error: "File was not found in your workspace." }, 404);
  const conflict = () => response({ ok: false, error: "The file changed. Read the current copy before saving." }, 409);
  if (operation === "read") {
    const [row] = await sql.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id = $1 and path = $2", [owner, path]);
    if (!row) return missing();
    const result = { path, content: row.text_copy };
    return response({ ok: true, ...result, result });
  }
  if (operation === "write") {
    const content = body.content;
    if (typeof content !== "string" || content.length > 1_000_000) return response({ ok: false, error: "Enter up to 1,000,000 characters." }, 400);
    if (!sql.transaction) return response({ ok: false, error: "Account storage is unavailable." }, 503);
    return sql.transaction(async (tx) => {
      if (typeof body.expectedContent !== "string") {
        const inserted = await tx.query("insert into mind_kimi_file (user_id, path, text_copy, bytes) values ($1,$2,$3,$4) on conflict do nothing returning path", [owner, path, content, Buffer.byteLength(content)]);
        if (inserted.length) {
          const result = { path, before: "", after: content };
          return response({ ok: true, ...result, result });
        }
      }
      if (body.expectedMissing === true) return conflict();
      const [current] = await tx.query<{ text_copy: string }>("select text_copy from mind_kimi_file where user_id = $1 and path = $2 for update", [owner, path]);
      if (!current || (typeof body.expectedContent === "string" && body.expectedContent !== current.text_copy)) return conflict();
      await tx.query("update mind_kimi_file set text_copy=$3, bytes=$4, updated_at=now() where user_id=$1 and path=$2", [owner, path, content, Buffer.byteLength(content)]);
      const result = { path, before: current.text_copy, after: content };
      return response({ ok: true, ...result, result });
    });
  }
  if (body.confirm !== true) return response({ ok: false, error: "Confirm the file change." }, 400);
  if (operation === "rename") {
    const to = accountFilePath(body.to);
    if (!to) return response({ ok: false, error: "Choose a destination inside your workspace." }, 400);
    try {
      const moved = await sql.query("update mind_kimi_file set path=$3, updated_at=now() where user_id=$1 and path=$2 returning path", [owner, path, to]);
      return moved.length ? response({ ok: true, path, to }) : missing();
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") return response({ ok: false, error: "The destination file already exists." }, 409);
      throw error;
    }
  }
  const deleted = await sql.query("delete from mind_kimi_file where user_id=$1 and path=$2 returning path", [owner, path]);
  return deleted.length ? response({ ok: true, path }) : missing();
}
