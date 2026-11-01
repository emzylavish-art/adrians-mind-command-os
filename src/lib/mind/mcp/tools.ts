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

/** Each pattern must match the WHOLE command (anchored both ends). */
const DEFAULT_SHELL_ALLOWLIST = [/^pwd$/, /^uname( -[a-z]+)?$/, /^echo [A-Za-z0-9 _.,:=+\/-]+$/, /^date$/, /^whoami$/];

/**
 * Characters a paired agent's shell (sh, cmd.exe, PowerShell) could treat as
 * syntax: chaining (; & | newline), substitution ($ ` ( ) { }), redirection
 * (< >), globbing (* ? [ ] ~), escapes/quotes (\\ ' " ^ %), history (!), comments (#).
 * Allowlisted commands run WITHOUT human approval, so anything outside this
 * plain set must go through the approval flow instead.
 */
const SHELL_SAFE_CHARS = /^[A-Za-z0-9 _.,:=+\/-]+$/;
const SHELL_ALLOWLIST_MAX = 200;

export function isShellAllowlisted(command: string, patterns: RegExp[] = DEFAULT_SHELL_ALLOWLIST): boolean {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > SHELL_ALLOWLIST_MAX) return false;
  if (!SHELL_SAFE_CHARS.test(trimmed)) return false;
  return patterns.some((pattern) => pattern.test(trimmed));
}

/**
 * Run a command on a paired PC agent when MIND_PC_AGENT_URL (or similar) is set.
 * Allowlisted commands run. Non-allowlisted commands require a server-issued
 * human approval via the app UI — tool-arg confirm/approved/approvalId are ignored.
 */
export async function pcRunShell(input: {
  command: string;
  /** @deprecated Ignored — model/client confirm cannot authorize shell. */
  confirm?: boolean;
  /** @deprecated Ignored */
  approved?: boolean;
  /** @deprecated Ignored — approvals are consumed only by the human approve route. */
  approvalId?: string;
  ownerId?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: NotionFetch;
  /** Injected for tests — when set, skips pairing store / HTTP */
  pairingRunner?: (args: { ownerId: string; command: string; confirm: boolean }) => Promise<ToolResult | null>;
  /** Injected for tests */
  isHalted?: (ownerId: string) => boolean | Promise<boolean>;
  /** Injected for tests */
  createApproval?: (args: {
    ownerId: string;
    command: string;
    agentId: string;
    agentLabel: string;
  }) => { id: string };
  /** Injected for tests */
  onlineAgents?: (ownerId: string) => { id: string; label: string }[];
}): Promise<ToolResult> {
  const command = input.command.trim().slice(0, 500);
  if (!command) return { ok: false, status: "error", text: "No command was provided. Nothing ran." };

  // Strip any client-supplied approval claims — they never authorize execution.
  void input.confirm;
  void input.approved;
  void input.approvalId;

  if (input.ownerId) {
    const haltedFn =
      input.isHalted ??
      (async (ownerId: string) => {
        const { readHaltFile } = await import("../halt-file.ts");
        const file = readHaltFile(ownerId);
        return Boolean(file.ownerId && file.halted);
      });
    if (await haltedFn(input.ownerId)) {
      return {
        ok: false,
        status: "error",
        text: "Emergency stop is on. pc_run_shell will not run or request approval. Nothing ran.",
      };
    }
  }

  const allowed = isShellAllowlisted(command);
  const env = input.env ?? process.env;

  // Non-allowlisted: create a pending human approval; do not run.
  if (!allowed) {
    if (!input.ownerId) {
      return {
        ok: false,
        status: "error",
        text: "That command is not on the allowlist and no signed-in owner is available to approve it. Nothing ran.",
      };
    }

    let online: { id: string; label: string }[];
    if (input.onlineAgents) {
      online = input.onlineAgents(input.ownerId);
    } else {
      const { onlineAgents } = await import("../pc-pairing/store.ts");
      online = onlineAgents(input.ownerId).map((a) => ({ id: a.id, label: a.label }));
    }

    if (online.length === 0) {
      const endpoint = (env.MIND_PC_AGENT_URL || env.PC_AGENT_URL || env.PAIRED_PC_URL || "").trim();
      if (!endpoint) {
        return {
          ok: false,
          status: "error",
          text: "That command is not on the allowlist. No paired PC online to approve against. Nothing ran.",
        };
      }
      return {
        ok: false,
        status: "error",
        text: "That command is not on the allowlist. Approve it in the Tools panel (human click). Tool confirm flags are ignored. Nothing ran.",
      };
    }

    const agent = online[0];
    let approvalId: string;
    if (input.createApproval) {
      approvalId = input.createApproval({
        ownerId: input.ownerId,
        command,
        agentId: agent.id,
        agentLabel: agent.label,
      }).id;
    } else {
      const { createPcApproval } = await import("../pc-pairing/approvals.ts");
      const record = createPcApproval({
        ownerId: input.ownerId,
        command,
        agentId: agent.id,
        agentLabel: agent.label,
      });
      approvalId = record.id;
    }

    return {
      ok: false,
      status: "error",
      text: `That command needs your approval before it can run on the paired PC. Open Tools and approve request ${approvalId}. Tool confirm/approved flags are ignored. Nothing ran.`,
      data: { needsApproval: true, approvalId, command, agentId: agent.id },
    };
  }

  // Allowlisted — run via pairing or legacy HTTP (confirm:true means server-authorized allowlist).
  if (input.ownerId) {
    const runner =
      input.pairingRunner ??
      (async (args) => {
        const { runOnPairedAgent } = await import("../pc-pairing/run.ts");
        const result = await runOnPairedAgent(args);
        if (!result) return null;
        return { ok: result.ok, status: result.status, text: result.text, data: result.data };
      });
    const paired = await runner({ ownerId: input.ownerId, command, confirm: true });
    if (paired) return paired;
  }

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
      body: JSON.stringify({ command, confirm: true }),
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
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|reindex|cluster|comment|security|owner|refresh|listen|notify|set\s+role|reset\s+role|load|discard|into|prepare|deallocate|lock|checkpoint|import)\b/i;

/** Row-locking reads (FOR SHARE / FOR KEY SHARE / FOR NO KEY UPDATE) hold locks on the shared connection. */
const LOCKING_READ = /\bfor\s+(share|key\s+share|no\s+key\s+update|update)\b/i;

/**
 * Functions that change session/database state, touch files or other backends,
 * run nested SQL strings, or block the (single-threaded) PGLite engine.
 * PGLite runs synchronously inside the Node event loop and ignores
 * statement_timeout, so a long call freezes the whole server, not just this query.
 */
const SIDE_EFFECT_FUNCTIONS = new RegExp(
  "\\b(" +
    [
      "set_config",
      "nextval",
      "setval",
      "pg_sleep(?:_for|_until)?",
      "pg_(?:try_)?advisory\\w*",
      "lo_\\w+",
      "lowrite",
      "loread",
      "(?:query|cursor)_to_xml\\w*",
      "query_to_xml_and_xmlschema",
      "dblink\\w*",
      "pg_read_(?:binary_)?file",
      "pg_ls_\\w+",
      "pg_stat_file",
      "pg_file_\\w+",
      "pg_terminate_backend",
      "pg_cancel_backend",
      "pg_reload_conf",
      "pg_rotate_logfile",
      "pg_switch_wal",
      "pg_promote",
      "pg_(?:create|drop|copy)_\\w+",
      "pg_replication_\\w+",
      "pg_logical_\\w+",
      "pg_notify",
      "pg_import_system_collations",
      "pg_stat_reset\\w*",
      "pg_backup_\\w+",
      "pg_(?:start|stop)_backup",
      "pg_wal_replay_\\w+",
      "pg_log_backend_memory_contexts",
      "txid_current",
      "pg_current_xact_id",
    ].join("|") +
    ")\\s*\\(",
  "i",
);

/** Unicode-escape identifiers/strings (U&"\\0073et_config") hide names from every word check. */
const UNICODE_ESCAPE = /\bu&\s*['"]/i;

/** Reject multi-statement payloads, write verbs, side-effect functions, and escape tricks. */
export function assertReadOnlySql(sql: string): { ok: true; sql: string; explain: boolean } | { ok: false; text: string } {
  let trimmed = sql.trim();
  if (!trimmed) return { ok: false, text: "SQL is empty. Nothing was queried." };
  if (trimmed.length > 20_000) {
    return { ok: false, text: "SQL is too long (over 20,000 characters). Nothing was queried." };
  }
  if (trimmed.includes("\u0000")) {
    return { ok: false, text: "SQL contains a NUL byte. Nothing was queried." };
  }
  // Strip one trailing semicolon only; extra statements are refused.
  trimmed = trimmed.replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    return { ok: false, text: "Multiple SQL statements are not allowed. Nothing was queried." };
  }
  // Block classic comment-smuggled writes and dollar-quote escapes lightly
  const withoutLineComments = trimmed.replace(/--[^\n]*/g, " ");
  const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (/\/\*|\*\//.test(withoutBlockComments)) {
    // Nested or unterminated block comments can hide text from the checks below.
    return { ok: false, text: "Nested or unterminated SQL comments are not allowed. Nothing was queried." };
  }
  if (UNICODE_ESCAPE.test(withoutBlockComments)) {
    return { ok: false, text: "Unicode-escaped identifiers or strings (U&) are not allowed in pglite_query. Nothing was queried." };
  }
  if (WRITE_SQL.test(withoutBlockComments) || LOCKING_READ.test(withoutBlockComments)) {
    return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
  }
  // Quoted identifiers ("set_config"(...)) would otherwise slip past the name check.
  const fn = SIDE_EFFECT_FUNCTIONS.exec(withoutBlockComments.replace(/"/g, ""));
  if (fn) {
    return {
      ok: false,
      text: `pglite_query refuses ${fn[1]}(): it changes database or session state, reaches outside the database, or can freeze the server. Nothing was run.`,
    };
  }
  if (!/^\s*(select|with|explain)\b/i.test(withoutBlockComments)) {
    return { ok: false, text: "Only SELECT, WITH, or EXPLAIN statements are allowed. Nothing was queried." };
  }
  const explain = /^\s*explain\b/i.test(withoutBlockComments);
  if (explain && /\banaly[sz]e\b/i.test(withoutBlockComments)) {
    return { ok: false, text: "EXPLAIN ANALYZE runs the statement, so it is not allowed in pglite_query. Use plain EXPLAIN. Nothing was run." };
  }
  return { ok: true, sql: trimmed, explain };
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
  // EXPLAIN cannot sit inside a subquery, so it runs as-is (its output is a short plan).
  const limitedSql = checked.explain ? checked.sql : `SELECT * FROM (${checked.sql}) AS _mind_q LIMIT ${rowLimit}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const allRows = await Promise.race([
      input.sqlClient.query(limitedSql, input.params ?? []),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Query timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    const rows = Array.isArray(allRows) ? allRows.slice(0, rowLimit) : [];
    return {
      ok: true,
      status: "ok",
      text: JSON.stringify({ rowCount: rows.length, rowLimit, rows }, null, 2).slice(0, 8000),
      data: { rowCount: rows.length, rowLimit, rows },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed.";
    return { ok: false, status: "error", text: `PGLite query error: ${message}` };
  } finally {
    if (timer) clearTimeout(timer);
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
    description: "Run a shell command on the paired PC agent. Allowlisted commands run; others need a human approval in Tools (confirm tool args are ignored). Honest failure when no PC is paired.",
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
