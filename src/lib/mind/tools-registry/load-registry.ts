/**
 * Governance #73: load tools/registry.json with hard exclusions and verification gates.
 * Callable MCP/chat tools remain owned by src/lib/mind/mcp/tool-catalog.ts (SSOT).
 * This module feeds /tools and derived registry views — it never invents adapters.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TOOL_CATALOG, EXCLUDED_TOOL_NAMES, isExcludedToolName } from "../mcp/tool-catalog.ts";

export const HARD_EXCLUDED_REGISTRY_NAMES = [
  ...EXCLUDED_TOOL_NAMES,
  "BlackEye",
  "L1B3RT4S",
] as const;

const GODEYE_NAMES = new Set(["godeye", "god's eyes", "gods eyes", "god eye", "god's eye"]);

export type RegistryToolStatus =
  | "source-resolution-required"
  | "identified"
  | "reviewed"
  | "scaffolded"
  | "implemented"
  | "tested"
  | "live-verified"
  | "blocked"
  | "restricted"
  | "identity-unconfirmed"
  | "source-verified";

export type RegistryToolEntry = {
  name: string;
  category?: string;
  status: RegistryToolStatus | string;
  install?: string;
  live?: string;
  source_url?: string | null;
  team_agent?: string;
  note?: string;
  guardrail?: string;
  evidence?: string;
  verifiedAt?: string;
  [key: string]: unknown;
};

export type ToolVerificationRecord = {
  toolName: string;
  verifiedAt: string;
  evidence: string;
  verifiedBy?: string;
};

export type LoadedRegistryTool = RegistryToolEntry & {
  callable: boolean;
  verification: ToolVerificationRecord | null;
  githubSourced: boolean;
  excluded: boolean;
  reasonNotCallable?: string;
};

function defaultToolsRoot(): string {
  // Prefer cwd/tools (app root), then walk up from this module toward repo tools/.
  const cwdTools = join(process.cwd(), "tools");
  if (existsSync(join(cwdTools, "registry.json"))) return cwdTools;
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "tools");
    if (existsSync(join(candidate, "registry.json"))) return candidate;
    dir = dirname(dir);
  }
  return cwdTools;
}

export function toolNameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isHardExcludedRegistryName(name: string): boolean {
  if (isExcludedToolName(name)) return true;
  const n = name.trim().toLowerCase();
  return n === "blackeye" || n === "l1b3rt4s";
}

export function isGodEyeName(name: string): boolean {
  return GODEYE_NAMES.has(name.trim().toLowerCase());
}

/** GitHub-sourced = github.com URL, or explicit git-submodule install, or GodEye (per #73). */
export function isGithubSourcedRegistryTool(entry: RegistryToolEntry): boolean {
  if (isGodEyeName(entry.name)) return true;
  const url = typeof entry.source_url === "string" ? entry.source_url : "";
  if (/^https?:\/\/(www\.)?github\.com\//i.test(url)) return true;
  const install = String(entry.install || "");
  if (install.includes("git-submodule")) return true;
  return false;
}

export function loadVerificationRecords(verificationsDir?: string): Map<string, ToolVerificationRecord> {
  const dir = verificationsDir ?? join(defaultToolsRoot(), "verifications");
  const out = new Map<string, ToolVerificationRecord>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as Partial<ToolVerificationRecord>;
      if (!raw.toolName || !raw.verifiedAt || !raw.evidence) continue;
      const rec: ToolVerificationRecord = {
        toolName: String(raw.toolName),
        verifiedAt: String(raw.verifiedAt),
        evidence: String(raw.evidence),
        ...(raw.verifiedBy ? { verifiedBy: String(raw.verifiedBy) } : {}),
      };
      out.set(toolNameSlug(rec.toolName), rec);
      out.set(toolNameSlug(name.replace(/\.json$/i, "")), rec);
    } catch {
      /* skip bad file */
    }
  }
  return out;
}

export function loadRegistryJsonFile(registryPath?: string): { schemaVersion?: number; tools: RegistryToolEntry[]; note?: string } {
  const path = registryPath ?? join(defaultToolsRoot(), "registry.json");
  if (!existsSync(path)) {
    return { tools: [] };
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    schemaVersion?: number;
    note?: string;
    tools?: RegistryToolEntry[];
  };
  const tools = Array.isArray(raw.tools) ? raw.tools : [];
  return { schemaVersion: raw.schemaVersion, note: raw.note, tools };
}

/**
 * Load registry for /tools: hard-exclude BlackEye/L1B3RT4S at load;
 * GitHub-sourced (incl. GodEye) are not callable until a verification record exists.
 */
export function loadFilteredToolRegistry(opts?: {
  registryPath?: string;
  verificationsDir?: string;
}): LoadedRegistryTool[] {
  const { tools } = loadRegistryJsonFile(opts?.registryPath);
  const verifications = loadVerificationRecords(opts?.verificationsDir);
  const out: LoadedRegistryTool[] = [];
  for (const entry of tools) {
    const name = String(entry.name || "").trim();
    if (!name) continue;
    if (isHardExcludedRegistryName(name)) {
      // Hard exclude at load — never surface.
      continue;
    }
    const githubSourced = isGithubSourcedRegistryTool(entry);
    const verification = verifications.get(toolNameSlug(name)) ?? null;
    const restricted = entry.status === "restricted" || entry.install === "blocked" || entry.live === "blocked";
    let callable = false;
    let reasonNotCallable: string | undefined;
    if (restricted) {
      reasonNotCallable = "restricted";
    } else if (githubSourced && !verification) {
      reasonNotCallable = "unverified-github-source";
    } else if (githubSourced && verification) {
      callable = true;
    } else if (entry.status === "live-verified" || entry.live === "connected") {
      callable = true;
    } else {
      reasonNotCallable = "not-live-verified";
    }
    out.push({
      ...entry,
      name,
      excluded: false,
      githubSourced,
      verification,
      callable,
      ...(reasonNotCallable ? { reasonNotCallable } : {}),
    });
  }
  return out;
}

/** Builtin MCP catalog projected into registry-shaped rows (SSOT → /tools). */
export function builtinCatalogAsRegistryEntries(): LoadedRegistryTool[] {
  return BUILTIN_TOOL_CATALOG.filter((t) => !isExcludedToolName(t.name)).map((t) => ({
    name: t.name,
    category: "mcp-builtin",
    status: "implemented",
    install: "repo-code-present",
    live: "callable-cli-runner-and-mcp",
    note: t.description,
    source_url: null,
    callable: true,
    verification: null,
    githubSourced: false,
    excluded: false,
    builtinId: t.id,
  }));
}

/** Full /tools payload: catalog builtins + filtered github registry (exclusions applied). */
export function loadToolsPagePayload(opts?: {
  registryPath?: string;
  verificationsDir?: string;
}): {
  sourceOfTruth: "src/lib/mind/mcp/tool-catalog.ts";
  builtins: LoadedRegistryTool[];
  registry: LoadedRegistryTool[];
  hardExcluded: readonly string[];
} {
  return {
    sourceOfTruth: "src/lib/mind/mcp/tool-catalog.ts",
    builtins: builtinCatalogAsRegistryEntries(),
    registry: loadFilteredToolRegistry(opts),
    hardExcluded: HARD_EXCLUDED_REGISTRY_NAMES,
  };
}

export function assertRegistryLoadInvariants(opts?: {
  registryPath?: string;
  verificationsDir?: string;
}): void {
  const loaded = loadFilteredToolRegistry(opts);
  for (const t of loaded) {
    if (isHardExcludedRegistryName(t.name)) {
      throw new Error(`Hard-excluded tool leaked into load: ${t.name}`);
    }
    if (t.githubSourced && !t.verification && t.callable) {
      throw new Error(`Unverified GitHub-sourced tool marked callable: ${t.name}`);
    }
  }
  const raw = loadRegistryJsonFile(opts?.registryPath).tools;
  const hadBlackEye = raw.some((t) => isHardExcludedRegistryName(String(t.name || "")));
  if (!hadBlackEye) {
    // Registry on disk should still list exclusions so we prove the filter runs — warn via throw in tests only.
  }
}
