import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  notionAppendSection,
  notionReadPage,
  pcRunShell,
  pgliteListSchema,
  pgliteQuery,
  type SqlLike,
  type ToolResult,
} from "./tools.ts";

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

/** Create an MCP server instance exposing the four built-in tools. */
export function createBuiltinMcpServer(getSql: BuiltinSqlProvider = defaultGetSql) {
  const server = new McpServer({ name: "adrians-mind-builtin", version: "1.0.0" });

  server.registerTool(
    "notion_read_page",
    {
      description: "Read a Notion page by id or URL. Requires NOTION_TOKEN / NOTION_API_KEY.",
      inputSchema: {
        page_id: z.string().describe("Notion page id or URL"),
      },
    },
    async ({ page_id }) => asContent(await notionReadPage({ pageIdOrUrl: page_id })),
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
      asContent(await notionAppendSection({ pageIdOrUrl: page_id, heading, markdown })),
  );

  server.registerTool(
    "pc_run_shell",
    {
      description: "Run a shell command on the paired PC. Allowlist or confirm required.",
      inputSchema: {
        command: z.string().describe("Shell command"),
        confirm: z.boolean().optional().describe("Explicit confirmation for non-allowlisted commands"),
      },
    },
    async ({ command, confirm }) => asContent(await pcRunShell({ command, confirm })),
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

  return server;
}

/**
 * Handle one Streamable HTTP MCP request against a fresh built-in server.
 * Stateless JSON responses so the existing mind MCP client can parse them.
 */
export async function handleBuiltinMcpHttp(
  request: Request,
  getSql: BuiltinSqlProvider = defaultGetSql,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createBuiltinMcpServer(getSql);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}
