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

async function resolveNotionTokenPersistent(ownerId?: string): Promise<string | undefined> {
  // Registry discovery and non-Notion tools do not need an OAuth database.
  // Resolve it only when an actual Notion operation needs a saved credential.
  const notion = await import("../connectors/notion-oauth.ts");
  return notion.resolveNotionTokenPersistent(ownerId);
}

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
  const token = input.token ?? await resolveNotionTokenPersistent(input.ownerId);
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
  const token = input.token ?? await resolveNotionTokenPersistent(input.ownerId);
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
        const { haltIsOn } = await import("../halt.server.ts");
        return haltIsOn(ownerId);
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


const WRITE_SQL_KEYWORDS = new Set(
  [
    "insert",
    "update",
    "delete",
    "drop",
    "alter",
    "truncate",
    "create",
    "grant",
    "revoke",
    "copy",
    "call",
    "do",
    "execute",
    "merge",
    "vacuum",
    "reindex",
    "cluster",
    "comment",
    "security",
    "owner",
    "refresh",
    "listen",
    "notify",
    "load",
    "discard",
    "into",
    "prepare",
    "deallocate",
    "lock",
    "checkpoint",
    "import",
  ].map((k) => k.toLowerCase()),
);

const SIDE_EFFECT_FUNCTION_NAMES = new Set(
  [
    "set_config",
    "nextval",
    "setval",
    "pg_sleep",
    "pg_sleep_for",
    "pg_sleep_until",
    "lo_creat",
    "lo_create",
    "lo_export",
    "lo_import",
    "lo_from_bytea",
    "lo_get",
    "lo_put",
    "lo_unlink",
    "lo_open",
    "lo_close",
    "lo_lseek",
    "lo_lseek64",
    "lo_tell",
    "lo_tell64",
    "lo_truncate",
    "lo_truncate64",
    "lowrite",
    "loread",
    "query_to_xml",
    "query_to_xmlschema",
    "query_to_xml_and_xmlschema",
    "cursor_to_xml",
    "cursor_to_xmlschema",
    "dblink",
    "dblink_exec",
    "dblink_connect",
    "dblink_disconnect",
    "dblink_send_query",
    "dblink_get_result",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_stat_file",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "pg_reload_conf",
    "pg_rotate_logfile",
    "pg_switch_wal",
    "pg_promote",
    "pg_notify",
    "pg_import_system_collations",
    "txid_current",
    "pg_current_xact_id",
  ].map((k) => k.toLowerCase()),
);

function isSideEffectFunctionName(name: string): boolean {
  const n = name.toLowerCase();
  if (SIDE_EFFECT_FUNCTION_NAMES.has(n)) return true;
  if (n.startsWith("pg_advisory") || n.startsWith("pg_try_advisory")) return true;
  if (n.startsWith("lo_")) return true;
  if (n.startsWith("dblink")) return true;
  if (n.startsWith("pg_ls_")) return true;
  if (n.startsWith("pg_file_")) return true;
  if (n.startsWith("pg_create_") || n.startsWith("pg_drop_") || n.startsWith("pg_copy_")) return true;
  if (n.startsWith("pg_replication_") || n.startsWith("pg_logical_")) return true;
  if (n.startsWith("pg_stat_reset")) return true;
  if (n.startsWith("pg_backup_") || n === "pg_start_backup" || n === "pg_stop_backup") return true;
  if (n.startsWith("pg_wal_replay_")) return true;
  if (n === "pg_log_backend_memory_contexts") return true;
  if (n.startsWith("query_to_xml") || n.startsWith("cursor_to_xml")) return true;
  return false;
}

type SqlTok =
  | { kind: "ident"; value: string }
  | { kind: "number"; value: string }
  | { kind: "punct"; value: string }
  | { kind: "other" };

type TokenizeResult =
  | { ok: true; tokens: SqlTok[] }
  | { ok: false; text: string };

/**
 * Quote-aware tokenizer for the read-only SQL guard.
 * Literals and comments are consumed (not emitted). Keywords / function names
 * are checked only on identifier tokens that appear outside literals.
 */
export function tokenizeSqlForGuard(sql: string): TokenizeResult {
  const tokens: SqlTok[] = [];
  let i = 0;
  const n = sql.length;

  const peek = (k = 0) => (i + k < n ? sql[i + k] : "");
  const startsIdent = (ch: string) => /[A-Za-z_\u0080-\uFFFF]/.test(ch);
  const contIdent = (ch: string) => /[A-Za-z0-9_$\u0080-\uFFFF]/.test(ch);

  while (i < n) {
    const ch = sql[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Line comment --
    if (ch === "-" && peek(1) === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }

    // Block comment /* */ with nesting, outside literals only
    if (ch === "/" && peek(1) === "*") {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && peek(1) === "*") {
          depth += 1;
          i += 2;
          continue;
        }
        if (sql[i] === "*" && peek(1) === "/") {
          depth -= 1;
          i += 2;
          continue;
        }
        i += 1;
      }
      if (depth !== 0) {
        return { ok: false, text: "Nested or unterminated SQL comments are not allowed. Nothing was queried." };
      }
      continue;
    }

    // Dollar-quoted string: $$...$$ or $tag$...$tag$
    if (ch === "$") {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      if (j < n && sql[j] === "$") {
        const tag = sql.slice(i, j + 1); // includes both $
        const close = sql.indexOf(tag, j + 1);
        if (close < 0) {
          return { ok: false, text: "Unterminated dollar-quoted string. Nothing was queried." };
        }
        i = close + tag.length;
        continue;
      }
      // Lone $ (e.g. operator) — treat as punct
      tokens.push({ kind: "punct", value: "$" });
      i += 1;
      continue;
    }

    // Unicode-escape string/ident U&'...' / U&"..." — refuse (hides names)
    if ((ch === "U" || ch === "u") && peek(1) === "&") {
      const after = peek(2);
      if (after === "'" || after === '"') {
        return { ok: false, text: "Unicode-escaped identifiers or strings (U&) are not allowed in pglite_query. Nothing was queried." };
      }
    }

    // Extended string E'...' with backslash escapes
    if ((ch === "E" || ch === "e") && peek(1) === "'") {
      i += 2;
      let closed = false;
      while (i < n) {
        if (sql[i] === "\\") {
          i += 2; // skip escaped char (including \' )
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) return { ok: false, text: "Unterminated string literal. Nothing was queried." };
      continue;
    }

    // Standard string '...' with '' escapes
    if (ch === "'") {
      i += 1;
      let closed = false;
      while (i < n) {
        if (sql[i] === "'" && peek(1) === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) return { ok: false, text: "Unterminated string literal. Nothing was queried." };
      continue;
    }
    // Double-quoted identifier "..." with "" escapes — emit unquoted ident text
    if (ch === '"') {
      i += 1;
      let value = "";
      let closed = false;
      while (i < n) {
        if (sql[i] === '"' && peek(1) === '"') {
          value += '"';
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          i += 1;
          closed = true;
          break;
        }
        value += sql[i];
        i += 1;
      }
      if (!closed) return { ok: false, text: "Unterminated quoted identifier. Nothing was queried." };
      tokens.push({ kind: "ident", value });
      continue;
    }

    // Ident / keyword
    if (startsIdent(ch)) {
      let j = i + 1;
      while (j < n && contIdent(sql[j])) j += 1;
      tokens.push({ kind: "ident", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers (bounds checks need the value; keyword checks ignore them)
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(peek(1)))) {
      let j = i + 1;
      while (j < n && /[0-9_.]/.test(sql[j])) j += 1;
      tokens.push({ kind: "number", value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Punctuation / operators of interest
    if (ch === ";" || ch === "(" || ch === ")" || ch === "," || ch === "." || ch === "*") {
      tokens.push({ kind: "punct", value: ch });
      i += 1;
      continue;
    }

    // Other operator chars — consume a run
    if (/[+\-*/%<>=~!@^&|?]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[+\-*/%<>=~!@^&|?]/.test(sql[j])) j += 1;
      tokens.push({ kind: "other" });
      i = j;
      continue;
    }

    // Unknown char — skip conservatively as other
    tokens.push({ kind: "other" });
    i += 1;
  }

  return { ok: true, tokens };
}

function nextNonOther(tokens: SqlTok[], from: number): { idx: number; tok: SqlTok } | null {
  for (let i = from; i < tokens.length; i += 1) {
    if (tokens[i].kind !== "other") return { idx: i, tok: tokens[i] };
  }
  return null;
}

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
  // Strip one trailing semicolon only; extra statements are refused via tokens.
  trimmed = trimmed.replace(/;\s*$/, "");

  const tokenized = tokenizeSqlForGuard(trimmed);
  if (!tokenized.ok) return tokenized;
  const { tokens } = tokenized;

  for (const tok of tokens) {
    if (tok.kind === "punct" && tok.value === ";") {
      return { ok: false, text: "Multiple SQL statements are not allowed. Nothing was queried." };
    }
  }

  // Build lowercase ident list with following-punct awareness
  const idents: { value: string; index: number }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.kind === "ident") idents.push({ value: tok.value.toLowerCase(), index: i });
  }

  if (idents.length === 0) {
    return { ok: false, text: "Only SELECT, WITH, or EXPLAIN statements are allowed. Nothing was queried." };
  }

  const first = idents[0].value;
  if (first !== "select" && first !== "with" && first !== "explain") {
    return { ok: false, text: "Only SELECT, WITH, or EXPLAIN statements are allowed. Nothing was queried." };
  }

  // Write keywords / INTO / SET ROLE etc. on identifier tokens only
  for (let k = 0; k < idents.length; k += 1) {
    const word = idents[k].value;
    if (WRITE_SQL_KEYWORDS.has(word)) {
      return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
    }
    if (word === "set" || word === "reset") {
      const nxt = k + 1 < idents.length ? idents[k + 1].value : "";
      if (nxt === "role" || nxt === "session" || nxt === "transaction") {
        return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
      }
    }
  }

  // FOR SHARE / FOR UPDATE locking clause: ident sequence for + (share|update|key)
  for (let k = 0; k < idents.length; k += 1) {
    if (idents[k].value !== "for") continue;
    const a = idents[k + 1]?.value;
    const b = idents[k + 2]?.value;
    const c = idents[k + 3]?.value;
    if (a === "share" || a === "update") {
      return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
    }
    if (a === "key" && b === "share") {
      return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
    }
    if (a === "no" && b === "key" && c === "update") {
      return { ok: false, text: "pglite_query is read-only. Only a single SELECT / WITH / EXPLAIN is allowed. Nothing was changed." };
    }
  }

  // Side-effect function: ident (optionally schema.ident) followed by '('
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.kind !== "ident") continue;
    let name = tok.value;
    let j = i + 1;
    // schema.func
    if (
      tokens[j]?.kind === "punct" &&
      (tokens[j] as { kind: "punct"; value: string }).value === "." &&
      tokens[j + 1]?.kind === "ident"
    ) {
      name = (tokens[j + 1] as { kind: "ident"; value: string }).value;
      j = j + 2;
    }
    const next = nextNonOther(tokens, j);
    if (next && next.tok.kind === "punct" && next.tok.value === "(" && isSideEffectFunctionName(name)) {
      return {
        ok: false,
        text: `pglite_query refuses ${name}(): it changes database or session state, reaches outside the database, or can freeze the server. Nothing was run.`,
      };
    }
  }

  // H15: refuse recursive CTEs — they can hang single-threaded PGLite forever.
  for (const id of idents) {
    if (id.value === "recursive") {
      return {
        ok: false,
        text: "pglite_query refuses recursive CTEs (they can hang the server). Rewrite without RECURSIVE. Nothing was run.",
      };
    }
  }

  // H15: cap generate_series bounds (and refuse non-literal / multi-series bombs).
  const GENERATE_SERIES_MAX = 10_000;
  let generateSeriesCalls = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.kind !== "ident" || tok.value.toLowerCase() !== "generate_series") continue;
    let j = i + 1;
    // optional schema. prefix already consumed when this ident is the function name
    const open = nextNonOther(tokens, j);
    if (!open || open.tok.kind !== "punct" || open.tok.value !== "(") continue;
    generateSeriesCalls += 1;
    if (generateSeriesCalls > 1) {
      return {
        ok: false,
        text: "pglite_query allows at most one generate_series() call (cross joins can freeze the server). Nothing was run.",
      };
    }
    const nums: number[] = [];
    let depth = 0;
    let sawNonLiteralArg = false;
    for (let t = open.idx + 1; t < tokens.length; t += 1) {
      const cur = tokens[t];
      if (cur.kind === "punct" && cur.value === "(") {
        depth += 1;
        sawNonLiteralArg = true;
        continue;
      }
      if (cur.kind === "punct" && cur.value === ")") {
        if (depth === 0) break;
        depth -= 1;
        continue;
      }
      if (depth > 0) continue;
      if (cur.kind === "punct" && (cur.value === "," || cur.value === "+") ) continue;
      if (cur.kind === "number") {
        const n = Number(cur.value);
        if (Number.isFinite(n)) nums.push(n);
        else sawNonLiteralArg = true;
        continue;
      }
      if (cur.kind === "punct" && cur.value === "-") {
        // negative bound handled if next is number — peek
        const nxt = tokens[t + 1];
        if (nxt?.kind === "number") {
          const n = -Number(nxt.value);
          if (Number.isFinite(n)) nums.push(n);
          t += 1;
          continue;
        }
      }
      if (cur.kind === "ident" || cur.kind === "other") {
        sawNonLiteralArg = true;
      }
    }
    if (sawNonLiteralArg || nums.length < 2) {
      return {
        ok: false,
        text: "pglite_query only allows generate_series(start, stop[, step]) with integer literals (max span 10000). Nothing was run.",
      };
    }
    const start = nums[0]!;
    const stop = nums[1]!;
    const step = Math.abs(nums[2] ?? 1) || 1;
    const span = Math.floor(Math.abs(stop - start) / step) + 1;
    if (span > GENERATE_SERIES_MAX) {
      return {
        ok: false,
        text: `pglite_query refuses generate_series spans over ${GENERATE_SERIES_MAX} rows (got ~${span}). Nothing was run.`,
      };
    }
  }

    const explain = first === "explain";
  if (explain) {
    for (const id of idents) {
      if (id.value === "analyze" || id.value === "analyse") {
        return { ok: false, text: "EXPLAIN ANALYZE runs the statement, so it is not allowed in pglite_query. Use plain EXPLAIN. Nothing was run." };
      }
    }
  }

  return { ok: true, sql: trimmed, explain };
}

export type SqlLike = {
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  /** Optional non-result exec for BEGIN/ROLLBACK/RESET. Falls back to query(). */
  exec?: (text: string) => Promise<void>;
  /**
   * Actual engine in use (not inferred from env). PGLite gets pre-exec complexity
   * limits; Postgres/Neon uses a dedicated client for SET LOCAL statement_timeout.
   */
  engine?: "pglite" | "postgres";
  /**
   * Neon/Postgres: run fn on a single pool.connect() client so SET LOCAL sticks,
   * then release. When absent, fn runs against `this` (tests / PGLite).
   */
  withExclusiveClient?: <T>(fn: (client: SqlLike) => Promise<T>) => Promise<T>;
};

async function sqlExec(client: SqlLike, text: string): Promise<void> {
  if (client.exec) {
    await client.exec(text);
    return;
  }
  await client.query(text);
}

export const PGLITE_DEFAULT_ROW_LIMIT = 100;
export const PGLITE_DEFAULT_TIMEOUT_MS = 5_000;
/** Cap JSON payload size returned to the model/UI. */
export const PGLITE_MAX_RESULT_CHARS = 8_000;

async function runReadOnlyQueryOnClient(
  client: SqlLike,
  limitedSql: string,
  params: unknown[],
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  try {
    await sqlExec(client, "RESET ALL");
  } catch {
    try {
      await sqlExec(client, "RESET search_path");
    } catch {
      /* ignore */
    }
  }
  let began = false;
  try {
    await sqlExec(client, "BEGIN READ ONLY");
    began = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "BEGIN READ ONLY failed";
    throw new Error(`BEGIN READ ONLY failed; refusing to run query: ${message}`);
  }
  try {
    try {
      await sqlExec(client, `SET LOCAL statement_timeout = ${timeoutMs}`);
    } catch {
      /* PGLite accepts but ignores; Postgres honors it. */
    }
    // Wall-clock race: effective for I/O-bound Postgres. For CPU-bound PGLite the
    // pre-exec complexity guard is the real protection; this still reports honestly
    // if the backend yields / aborts via statement_timeout.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const rows = await Promise.race([
        client.query(limitedSql, params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Query timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return rows;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    if (began) {
      try {
        await sqlExec(client, "ROLLBACK");
      } catch {
        /* ignore */
      }
    }
    try {
      await sqlExec(client, "RESET ALL");
    } catch {
      /* ignore */
    }
  }
}

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
  const limitedSql = checked.explain ? checked.sql : `SELECT * FROM (${checked.sql}) AS _mind_q LIMIT ${rowLimit}`;
  const params = input.params ?? [];
  const client = input.sqlClient;

  try {
    const run = (c: SqlLike) => runReadOnlyQueryOnClient(c, limitedSql, params, timeoutMs);
    const allRows =
      client.engine === "postgres" && client.withExclusiveClient
        ? await client.withExclusiveClient(run)
        : await run(client);
    const rows = Array.isArray(allRows) ? allRows.slice(0, rowLimit) : [];
    const payload = JSON.stringify({ rowCount: rows.length, rowLimit, rows }, null, 2);
    if (payload.length > PGLITE_MAX_RESULT_CHARS) {
      return {
        ok: true,
        status: "ok",
        text: payload.slice(0, PGLITE_MAX_RESULT_CHARS) + "\n…(truncated)",
        data: { rowCount: rows.length, rowLimit, rows, truncated: true },
      };
    }
    return {
      ok: true,
      status: "ok",
      text: payload,
      data: { rowCount: rows.length, rowLimit, rows },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query failed.";
    return { ok: false, status: "error", text: `PGLite query error: ${message}` };
  }
}

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
