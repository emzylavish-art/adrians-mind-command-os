import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  notionAppendSection,
  notionReadPage,
  pcRunShell,
  pgliteListSchema,
  pgliteQuery,
  storageListStatus,
  type SqlLike,
  type ToolResult,
} from "./tools.ts";
import {
  buildGitCommit,
  buildGitDiff,
  buildGitStatus,
  buildRepoList,
  buildRepoRead,
  buildTerminalRun,
} from "./build-workspace-tools.ts";
import { researchConnectorRead, researchDeep, researchFetchAllowlistedUrl } from "./research-sources.ts";

function asContent(result: ToolResult) {
  return {
    content: [{ type: "text" as const, text: result.text }],
    isError: !result.ok,
  };
}

export type BuiltinSqlProvider = () => Promise<SqlLike>;

async function defaultGetSql(): Promise<SqlLike> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/**
 * Create an MCP server instance exposing the built-in tools.
 * `ownerId` scopes Notion OAuth tokens and PC pairing to the signed-in user.
 */
export function createBuiltinMcpServer(getSql: BuiltinSqlProvider = defaultGetSql, ownerId?: string) {
  const server = new McpServer({ name: "adrians-mind-builtin", version: "1.0.0" });

  server.registerTool(
    "notion_read_page",
    {
      description: "Read a Notion page by id or URL. Requires NOTION_TOKEN / NOTION_API_KEY.",
      inputSchema: {
        page_id: z.string().describe("Notion page id or URL"),
      },
    },
    async ({ page_id }) => asContent(await notionReadPage({ pageIdOrUrl: page_id, ownerId })),
  );

  server.registerTool(
    "notion_append_section",
    {
      description: "Append a heading and markdown paragraph to a Notion page.",
      inputSchema: {
        page_id: z.string().describe("Notion page id or URL"),
        heading: z.string().describe("Section heading"),
        markdown: z.string().describe("Markdown / plain text body"),
      },
    },
    async ({ page_id, heading, markdown }) =>
      asContent(await notionAppendSection({ pageIdOrUrl: page_id, heading, markdown, ownerId })),
  );

  server.registerTool(
    "pc_run_shell",
    {
      description: "Run a shell command on the paired PC. Allowlisted commands run; others need human approval in Tools. confirm tool args are ignored.",
      inputSchema: {
        command: z.string().describe("Shell command"),
        confirm: z.boolean().optional().describe("Ignored. Human approval is required for non-allowlisted commands."),
      },
    },
    async ({ command }) => asContent(await pcRunShell({ command, ownerId })),
  );

  server.registerTool(
    "pglite_query",
    {
      description: "Read-only SQL against the app database (single SELECT/WITH/EXPLAIN; row limit + timeout).",
      inputSchema: {
        sql: z.string().describe("SQL query"),
      },
    },
    async ({ sql }) => {
      const sqlClient = await getSql();
      return asContent(await pgliteQuery({ sql, sqlClient }));
    },
  );

  server.registerTool(
    "pglite_list_schema",
    {
      description: "List non-system tables/views in the app database.",
      inputSchema: {},
    },
    async () => {
      const sqlClient = await getSql();
      return asContent(await pgliteListSchema({ sqlClient }));
    },
  );

  server.registerTool(
    "storage_list_status",
    {
      description:
        "List configured media storage connectors with honest connected/needs-config status. Read-only; never uploads.",
      inputSchema: {},
    },
    async () => {
      if (!ownerId) {
        return asContent({
          ok: false,
          status: "error",
          text: "Sign in is required to list storage connectors. Nothing was listed.",
        });
      }
      return asContent(await storageListStatus({ ownerId }));
    },
  );


  server.registerTool(
    "build_repo_list",
    {
      description: "List files under the BuildSession workspace root (MIND_BUILD_WORKSPACE_ROOT).",
      inputSchema: { path: z.string().optional().describe("Relative directory under the workspace root") },
    },
    async ({ path }) => asContent(await buildRepoList({ path })),
  );
  server.registerTool(
    "build_repo_read",
    {
      description: "Read a text file under the BuildSession workspace root.",
      inputSchema: {
        path: z.string().describe("Relative file path"),
        maxBytes: z.number().optional().describe("Optional max bytes"),
      },
    },
    async ({ path, maxBytes }) => asContent(await buildRepoRead({ path, maxBytes })),
  );
  server.registerTool(
    "build_terminal_run",
    {
      description: "Run an allowlisted BuildSession terminal command (not pc_run_shell).",
      inputSchema: {
        command: z.string().describe("Allowlisted command"),
        cwd: z.string().optional().describe("Optional relative cwd"),
      },
    },
    async ({ command, cwd }) => asContent(await buildTerminalRun({ command, cwd })),
  );
  server.registerTool(
    "build_git_status",
    {
      description: "git status --porcelain in the BuildSession workspace.",
      inputSchema: {},
    },
    async () => asContent(await buildGitStatus({})),
  );
  server.registerTool(
    "build_git_diff",
    {
      description: "git diff in the BuildSession workspace.",
      inputSchema: {
        path: z.string().optional(),
        staged: z.boolean().optional(),
      },
    },
    async ({ path, staged }) => asContent(await buildGitDiff({ path, staged })),
  );
  server.registerTool(
    "build_git_commit",
    {
      description: "git add (optional paths) + commit. Never push/force/reset --hard.",
      inputSchema: {
        message: z.string().describe("Commit message"),
        paths: z.array(z.string()).optional().describe("Optional paths to add"),
      },
    },
    async ({ message, paths }) => asContent(await buildGitCommit({ message, paths })),
  );

  server.registerTool(
    "research_deep",
    {
      description: "Deep research via configured search endpoint; Sites allowlist filters citations.",
      inputSchema: { query: z.string().describe("Research question") },
    },
    async ({ query }) => asContent(await researchDeep({ query })),
  );
  server.registerTool(
    "research_connector_read",
    {
      description: "Read-only research connector (notion + page_id).",
      inputSchema: {
        source: z.string().describe("notion"),
        page_id: z.string().describe("Notion page id or URL"),
      },
    },
    async ({ source, page_id }) => asContent(await researchConnectorRead({ source, page_id, ownerId })),
  );
  server.registerTool(
    "research_fetch_url",
    {
      description: "Fetch one Sites-allowlisted https URL (DNS-pinned).",
      inputSchema: { url: z.string().describe("https URL") },
    },
    async ({ url }) => asContent(await researchFetchAllowlistedUrl({ url })),
  );

  return server;
}

export type BuiltinHttpOptions = {
  /**
   * REQUIRED. Resolve the signed-in user for this request, or null/throw when
   * there is no valid session. Without it every request is refused (fail closed):
   * this endpoint exposes pglite_query, notion_* (server token) and pc_run_shell.
   */
  authenticate: (request: Request) => Promise<string | null | undefined>;
  getSql?: BuiltinSqlProvider;
  /** Emergency-stop check for the resolved owner. When true, nothing runs. */
  isHalted?: (ownerId: string) => Promise<boolean> | boolean;
};

function rpcError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(status === 401 ? { "www-authenticate": 'Bearer realm="mind-mcp"' } : {}),
    },
  });
}

/**
 * Handle one Streamable HTTP MCP request against a fresh built-in server.
 * Stateless JSON responses so the existing mind MCP client can parse them.
 *
 * SECURITY: the caller must be authenticated via `options.authenticate`.
 * Anonymous, forged, or legacy (no authenticator) calls get 401 before any
 * MCP server or tool is created, so no tool list or result can leak.
 */
export async function handleBuiltinMcpHttp(request: Request, options: BuiltinHttpOptions): Promise<Response> {
  const authenticate = options && typeof options === "object" ? options.authenticate : undefined;
  if (typeof authenticate !== "function") {
    return rpcError(401, -32001, "Sign in is required. No MCP tool was listed or called.");
  }
  let ownerId: string | null | undefined;
  try {
    ownerId = await authenticate(request);
  } catch {
    ownerId = null;
  }
  if (typeof ownerId !== "string" || !ownerId.trim()) {
    return rpcError(401, -32001, "Sign in is required. No MCP tool was listed or called.");
  }
  if (options.isHalted) {
    let halted = true;
    try {
      halted = await options.isHalted(ownerId);
    } catch {
      halted = true; // cannot read the stop switch -> do not run tools
    }
    if (halted) return rpcError(403, -32002, "Emergency stop is on. No MCP tool was called.");
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createBuiltinMcpServer(options.getSql ?? defaultGetSql, ownerId);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}
