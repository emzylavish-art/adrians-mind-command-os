/**
 * Canonical built-in MCP tool catalog for Adrian's Mind.
 * Lists ONLY real, wired capabilities in this codebase — never fabricates tools.
 * BlackEye / phishing kits are excluded. God's Eyes remains identity-unconfirmed (not listed).
 */
import { resolveNotionToken } from "../connectors/notion-oauth.ts";
import { onlineAgents } from "../pc-pairing/store.ts";
import { loadStorageAccountsConfig, orderedEnabledAccounts } from "../media/storage/config.ts";

function notionTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.NOTION_TOKEN?.trim() || env.NOTION_API_KEY?.trim();
  return token || undefined;
}

export type JsonSchemaProperty = {
  type?: string;
  description?: string;
};

export type JsonSchema = {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
};

/** Honest runtime health for a registry row or tool call. */
export type ToolHealth =
  | "ok"
  | "needs-config"
  | "needs-pairing"
  | "disabled"
  | "error"
  | "timeout";

export type BuiltinToolCatalogEntry = {
  id: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Whether the tool is part of the built-in server (always true here). */
  builtin: true;
};

export const BUILTIN_TOOL_CATALOG: readonly BuiltinToolCatalogEntry[] = [
  {
    id: "notion_read_page",
    name: "notion_read_page",
    description:
      "Read a Notion page by id or URL. Requires NOTION_TOKEN / NOTION_API_KEY or a connected Notion OAuth account.",
    builtin: true,
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Notion page id or URL" },
      },
      required: ["page_id"],
      additionalProperties: false,
    },
  },
  {
    id: "notion_append_section",
    name: "notion_append_section",
    description: "Append a heading and markdown paragraph to a Notion page. Requires Notion token or OAuth.",
    builtin: true,
    inputSchema: {
      type: "object",
      properties: {
        page_id: { type: "string", description: "Notion page id or URL" },
        heading: { type: "string", description: "Section heading" },
        markdown: { type: "string", description: "Markdown / plain text body" },
      },
      required: ["page_id", "heading", "markdown"],
      additionalProperties: false,
    },
  },
  {
    id: "pc_run_shell",
    name: "pc_run_shell",
    description:
      "Run a shell command on the paired PC agent. Allowlisted commands run; others need human approval in Tools (confirm tool args are ignored). Honest failure when no PC is paired.",
    builtin: true,
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command" },
        confirm: {
          type: "boolean",
          description: "Ignored. Human approval is required for non-allowlisted commands.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    id: "pglite_query",
    name: "pglite_query",
    description:
      "Run a read-only SQL query against the app PGLite (or Neon) database. Single SELECT/WITH/EXPLAIN only; row limit + timeout enforced.",
    builtin: true,
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query" },
      },
      required: ["sql"],
      additionalProperties: false,
    },
  },
  {
    id: "pglite_list_schema",
    name: "pglite_list_schema",
    description: "List non-system tables/views (read-only helper for exploring the app DB).",
    builtin: true,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    id: "storage_list_status",
    name: "storage_list_status",
    description:
      "List configured media storage connectors (Drive, Dropbox, OneDrive, pCloud, Box, Koofr) with honest connected/needs-config status. Read-only; never uploads.",
    builtin: true,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export type BuiltinCatalogToolName = (typeof BUILTIN_TOOL_CATALOG)[number]["name"];

/** Names that must never appear in the activatable registry. */
export const EXCLUDED_TOOL_NAMES = ["BlackEye", "blackeye", "L1B3RT4S"] as const;

export function isExcludedToolName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return EXCLUDED_TOOL_NAMES.some((x) => x.toLowerCase() === n) || /black\s*eye/.test(n);
}

export type HealthComputeInput = {
  toolName: string;
  enabled: boolean;
  ownerId?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests — whether any paired PC / agent URL is available. */
  hasPairedPc?: boolean;
  /** Injected for tests — whether any storage account is configured. */
  hasStorageAccounts?: boolean;
};

function notionConfigured(ownerId: string | undefined, env: NodeJS.ProcessEnv): boolean {
  if (notionTokenFromEnv(env)) return true;
  if (!ownerId) return false;
  try {
    return Boolean(resolveNotionToken(ownerId));
  } catch {
    return false;
  }
}

function pairedPcAvailable(input: HealthComputeInput): boolean {
  if (typeof input.hasPairedPc === "boolean") return input.hasPairedPc;
  const env = input.env ?? process.env;
  if ((env.MIND_PC_AGENT_URL || env.PC_AGENT_URL || env.PAIRED_PC_URL || "").trim()) return true;
  if (!input.ownerId) return false;
  try {
    return onlineAgents(input.ownerId).length > 0;
  } catch {
    return false;
  }
}

function storageConfigured(input: HealthComputeInput): boolean {
  if (typeof input.hasStorageAccounts === "boolean") return input.hasStorageAccounts;
  try {
    return orderedEnabledAccounts(loadStorageAccountsConfig()).length > 0;
  } catch {
    return false;
  }
}

/**
 * Honestly compute health for a built-in tool. Never claims ok when env/pairing is missing.
 */
export function computeBuiltinToolHealth(input: HealthComputeInput): ToolHealth {
  if (!input.enabled) return "disabled";
  const name = input.toolName;
  const env = input.env ?? process.env;

  if (name === "notion_read_page" || name === "notion_append_section") {
    return notionConfigured(input.ownerId, env) ? "ok" : "needs-config";
  }
  if (name === "pc_run_shell") {
    return pairedPcAvailable(input) ? "ok" : "needs-pairing";
  }
  if (name === "pglite_query" || name === "pglite_list_schema") {
    return "ok";
  }
  if (name === "storage_list_status") {
    return storageConfigured(input) ? "ok" : "needs-config";
  }
  return "error";
}

export function catalogEntryByName(name: string): BuiltinToolCatalogEntry | undefined {
  if (isExcludedToolName(name)) return undefined;
  return BUILTIN_TOOL_CATALOG.find((t) => t.name === name);
}

export function listCatalogEntries(): BuiltinToolCatalogEntry[] {
  return BUILTIN_TOOL_CATALOG.filter((t) => !isExcludedToolName(t.name)).map((t) => ({ ...t }));
}
