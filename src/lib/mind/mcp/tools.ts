import { resolveNotionToken } from "../connectors/notion-oauth.ts";
/**
 * Built-in MCP tool handlers for Adrian's Mind.
 * Honest failures only — never invent success for Notion, PC, or SQL.
 */

export type ToolResult = {
  ok: boolean;
  status: "ok" | "error";
  text: string;
  data?: unknown;
};

export type NotionFetch = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const NOTION_VERSION = "2022-06-28";

export function notionTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.NOTION_TOKEN?.trim() || env.NOTION_API_KEY?.trim();
  return token || undefined;
}


/** Accept a raw Notion page id or a notion.so / notion.site URL. */
export function parseNotionPageId(pageIdOrUrl: string): string | null {
  const raw = pageIdOrUrl.trim();
  if (!raw) return null;
  const fromUrl = raw.match(/([0-9a-f]{32})/i) || raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (fromUrl?.[1]) return fromUrl[1].replace(/-/g, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  if (/^[0-9a-f-]{32,36}$/i.test(raw)) {
    const hex = raw.replace(/-/g, "");
    if (hex.length === 32) return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }
  return null;
}

function richText(body: unknown): string {
  if (!body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) return "";
  const lines: string[] = [];
  for (const block of (body as { results: Record<string, unknown>[] }).results) {
    if (!block || typeof block !== "object") continue;
    const type = typeof block.type === "string" ? block.type : "";
    const payload = block[type];
    if (!payload || typeof payload !== "object") continue;
    const rich = (payload as { rich_text?: { plain_text?: string }[] }).rich_text;
    if (!Array.isArray(rich)) continue;
    const text = rich.map((part) => part.plain_text ?? "").join("").trim();
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

async function notionApi(
  fetchImpl: NotionFetch,
  token: string,
  path: string,
  init: RequestInit,
): Promise<{ ok: true; body: unknown } | { ok: false; text: string }> {
  let response: Awaited<ReturnType<NotionFetch>>;
  try {
    response = await fetchImpl(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    return { ok: false, text: "Notion could not be reached. Nothing was changed." };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Notion returned ${response.status}.`;
    return { ok: false, text: `${message} Nothing was invented.` };
  }
  return { ok: true, body };
}

export async function notionReadPage(input: {
  pageIdOrUrl: string;
  token?: string;
  ownerId?: string;
  fetch?: NotionFetch;
}): Promise<ToolResult> {
  const token = input.token ?? resolveNotionToken(input.ownerId) ?? notionTokenFromEnv();
  if (!token) {
    return {
      ok: false,
      status: "error",
      text: "Notion is not configured. Set NOTION_TOKEN or NOTION_API_KEY on the server. Nothing was read.",
    };
  }
  const pageId = parseNotionPageId(input.pageIdOrUrl);
  if (!pageId) return { ok: false, status: "error", text: "That is not a Notion page id or URL. Nothing was read." };
  const fetchImpl = input.fetch ?? (globalThis.fetch as NotionFetch);
  const blocks = await notionApi(fetchImpl, token, `/blocks/${pageId}/children?page_size=50`, { method: "GET" });
  if (!blocks.ok) return { ok: false, status: "error", text: blocks.text };
  const text = richText(blocks.body) || "(empty page)";
  return { ok: true, status: "ok", text, data: { pageId } };
}

export async function notionAppendSection(input: {
  pageIdOrUrl: string;
  heading: string;
  markdown: string;
  token?: string;
  ownerId?: string;
  fetch?: NotionFetch;
}): Promise<ToolResult> {
  const token = input.token ?? resolveNotionToken(input.ownerId) ?? notionTokenFromEnv();
  if (!token) {
    return {
      ok: false,
      status: "error",
      text: "Notion is not configured. Set NOTION_TOKEN or NOTION_API_KEY on the server. Nothing was written.",
    };
  }
  const pageId = parseNotionPageId(input.pageIdOrUrl);
  if (!pageId) return { ok: false, status: "error", text: "That is not a Notion page id or URL. Nothing was written." };
  const heading = input.heading.trim().slice(0, 200);
  const markdown = input.markdown.trim().slice(0, 4000);
  if (!heading || !markdown) return { ok: false, status: "error", text: "Heading and markdown are required. Nothing was written." };
  const fetchImpl = input.fetch ?? (globalThis.fetch as NotionFetch);
  const wrote = await notionApi(fetchImpl, token, `/blocks/${pageId}/children`, {
    method: "PATCH",
    body: JSON.stringify({
      children: [
        {
          object: "block",
          type: "heading_2",
          heading_2: { rich_text: [{ type: "text", text: { content: heading } }] },
        },
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: markdown.slice(0, 1900) } }] },
        },
      ],
    }),
  });
  if (!wrote.ok) return { ok: false, status: "error", text: wrote.text };
  return { ok: true, status: "ok", text: `Appended heading “${heading}” to page ${pageId}.`, data: { pageId, heading } };
}

const DEFAULT_SHELL_ALLOWLIST = [/^pwd$/, /^uname( -[a-z]+)?$/, /^echo /, /^date$/, /^whoami$/];

export function isShellAllowlisted(command: string, patterns: RegExp[] = DEFAULT_SHELL_ALLOWLIST): boolean {
  const trimmed = command.trim();
  return patterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Run a command on a paired PC agent when MIND_PC_AGENT_URL (or similar) is set.
 * Requires allowlist match OR confirm=true. Never fakes success.
 */
export async function pcRunShell(input: {
  command: string;
  confirm?: boolean;
  ownerId?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: NotionFetch;
  /** Injected for tests — when set, skips pairing store / HTTP */
  pairingRunner?: (args: { ownerId: string; command: string; confirm: boolean }) => Promise<ToolResult | null>;
}): Promise<ToolResult> {
  const command = input.command.trim().slice(0, 500);
  if (!command) return { ok: false, status: "error", text: "No command was provided. Nothing ran." };
  const confirmed = input.confirm === true;
  const allowed = isShellAllowlisted(command);
  if (!allowed && !confirmed) {
    return {
      ok: false,
      status: "error",
      text: "That command is not on the allowlist. Pass confirm=true after reviewing it. Nothing ran.",
    };
  }
  const env = input.env ?? process.env;

  // 1) In-app pairing contract (agent registers + polls). Never runs shell on this box.
  if (input.ownerId) {
    const runner =
      input.pairingRunner ??
      (async (args) => {
        const { runOnPairedAgent } = await import("../pc-pairing/run.ts");
        const result = await runOnPairedAgent(args);
        if (!result) return null;
        return { ok: result.ok, status: result.status, text: result.text, data: result.data };
      });
    const paired = await runner({ ownerId: input.ownerId, command, confirm: confirmed });
    if (paired) return paired;
  }

  // 2) Legacy HTTP agent URL (MIND_PC_AGENT_URL)
  const endpoint = (env.MIND_PC_AGENT_URL || env.PC_AGENT_URL || env.PAIRED_PC_URL || "").trim();
  if (!endpoint) {
    return { ok: false, status: "error", text: "No paired PC online. Nothing ran on a laptop or phone." };
  }
  const fetchImpl = input.fetch ?? (globalThis.fetch as NotionFetch);
  let response: Awaited<ReturnType<NotionFetch>>;
  try {
    response = await fetchImpl(endpoint.replace(/\/$/, "") + "/run", {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.MIND_PC_AGENT_TOKEN ? { authorization: `Bearer ${env.MIND_PC_AGENT_TOKEN}` } : {}) },
      body: JSON.stringify({ command, confirm: confirmed }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, status: "error", text: "No paired PC online. The pairing endpoint could not be reached. Nothing ran." };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Paired PC returned ${response.status}.`;
    return { ok: false, status: "error", text: `${message} Nothing was invented.` };
  }
  const out =
    body && typeof body === "object" && typeof (body as { output?: unknown }).output === "string"
      ? (body as { output: string }).output.slice(0, 8000)
      : JSON.stringify(body).slice(0, 8000);
  return { ok: true, status: "ok", text: out || "(empty output)", data: body as Record<string, unknown> };
}

const WRITE_SQL =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|reindex|cluster|comment|security|owner|refresh|listen|notify|set\s+role|reset\s+role|load|discard)\b/i;

/** Reject multi-statement payloads and write verbs anywhere (incl. CTE bodies). */
export function assertReadOnlySql(sql: string): { ok: true; sql: string } | { ok: false; text: string } {
  let trimmed = sql.trim();
  if (!trimmed) return { ok: false, text: "SQL is empty. Nothing was queried." };
  // Strip one trailing semicolon only; extra statements are refused.
  trimmed = trimmed.replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    return { ok: false, text: "Multiple SQL statements are not allowed. Nothing was queried." };
  }
  // Block classic comment-smuggled writes and dollar-quote escapes lightly
  const withoutLineComments = trimmed.replace(/--[^\n]*/g, " ");
  const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (WRITE_SQL.test(withoutBlockComments)) {
    return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
  }
  if (!/^\s*(select|with|explain)\b/i.test(withoutBlockComments)) {
    return { ok: false, text: "Only SELECT, WITH, or EXPLAIN statements are allowed. Nothing was queried." };
  }
  return { ok: true, sql: trimmed };
}

export const PGLITE_DEFAULT_ROW_LIMIT = 100;
export const PGLITE_DEFAULT_TIMEOUT_MS = 5_000;

export type SqlLike = {
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export async function pgliteQuery(input: {
  sql: string;
  params?: unknown[];
  sqlClient: SqlLike;
  rowLimit?: number;
  timeoutMs?: number;
}): Promise<ToolResult> {
  const checked = assertReadOnlySql(input.sql);
  if (!checked.ok) return { ok: false, status: "error", text: checked.text };
  const rowLimit = Math.min(Math.max(input.rowLimit ?? PGLITE_DEFAULT_ROW_LIMIT, 1), 500);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? PGLITE_DEFAULT_TIMEOUT_MS, 100), 30_000);
  const limitedSql = `SELECT * FROM (${checked.sql}) AS _mind_q LIMIT ${rowLimit}`;
  try {
    const rows = await Promise.race([
      input.sqlClient.query(limitedSql, input.params ?? []),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Query timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return {
      ok: true,
      status: "ok",
      text: JSON.stringify({ rowCount: rows.length, rowLimit, rows }, null, 2).slice(0, 8000),
      data: { rowCount: rows.length, rowLimit, rows },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed.";
    return { ok: false, status: "error", text: `PGLite query error: ${message}` };
  }
}

/** List base tables/views in public schema (read-only helper). */
export async function pgliteListSchema(input: { sqlClient: SqlLike }): Promise<ToolResult> {
  return pgliteQuery({
    sql: `SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name`,
    sqlClient: input.sqlClient,
    rowLimit: 200,
  });
}

export const BUILTIN_TOOL_DEFS = [
  {
    name: "notion_read_page",
    description: "Read a Notion page by id or URL. Requires NOTION_TOKEN / NOTION_API_KEY.",
  },
  {
    name: "notion_append_section",
    description: "Append a heading and markdown paragraph to a Notion page. Requires NOTION_TOKEN / NOTION_API_KEY.",
  },
  {
    name: "pc_run_shell",
    description: "Run a shell command on the paired PC agent. Allowlisted commands or confirm=true required. Honest failure when no PC is paired.",
  },
  {
    name: "pglite_query",
    description: "Run a read-only SQL query against the app PGLite (or Neon) database. Single SELECT/WITH/EXPLAIN only; row limit + timeout enforced.",
  },
  {
    name: "pglite_list_schema",
    description: "List non-system tables/views (read-only helper for exploring the app DB).",
  },
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_DEFS)[number]["name"];
