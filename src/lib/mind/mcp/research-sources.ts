/**
 * Research-layer helpers for Adrian's Mind MCP:
 * - Sites allowlist (ChatGPT Sites pattern) enforced server-side on citations
 * - Read-only connector corpus reads (Notion page only; never write tools)
 * - research_deep MCP wrapper around performDeepResearch
 *
 * SSRF: citation URLs must be http(s); optional page fetch uses DNS pin + private IP refuse.
 */
import { notionReadPage, type ToolResult } from "./tools.ts";
import { performDeepResearch, type ResearchCitation, type ResearchResult } from "../research.ts";
import {
  defaultDnsLookup,
  isLocalHostname,
  isPrivateAddressLiteral,
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type DnsLookupFn,
} from "./http-dns-pin.ts";

const MAX_ALLOWLIST = 64;
const MAX_FETCH_BYTES = 200_000;

/** Parse MIND_RESEARCH_SITES_ALLOWLIST = "example.com,*.wikipedia.org,docs.github.com" */
export function parseSitesAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\s]+/)) {
    const host = part.trim().toLowerCase().replace(/^\*\./, "*.");
    if (!host) continue;
    if (host.length > 253) continue;
    if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host.replace(/^\*\./, "x."))) {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
    if (out.length >= MAX_ALLOWLIST) break;
  }
  return out;
}

export function hostMatchesSitesAllowlist(hostname: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true; // empty allowlist = no extra domain filter
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const pattern of allowlist) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      if (host === suffix || host.endsWith("." + suffix)) return true;
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}

export function filterCitationsBySitesAllowlist(
  citations: ResearchCitation[],
  allowlist: string[],
): { kept: ResearchCitation[]; dropped: number } {
  if (!allowlist.length) return { kept: citations, dropped: 0 };
  const kept: ResearchCitation[] = [];
  let dropped = 0;
  for (const c of citations) {
    try {
      const u = new URL(c.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        dropped += 1;
        continue;
      }
      if (!hostMatchesSitesAllowlist(u.hostname, allowlist)) {
        dropped += 1;
        continue;
      }
      kept.push(c);
    } catch {
      dropped += 1;
    }
  }
  return { kept, dropped };
}

/** Safe research tools exposed in the MCP catalog (documentation helper). */
export const RESEARCH_SAFE_REGISTRY_TOOLS = [
  "research_deep",
  "research_connector_read",
  "notion_read_page",
  "pglite_list_schema",
  "pglite_query",
  "storage_list_status",
  "build_repo_list",
  "build_repo_read",
  "build_git_status",
  "build_git_diff",
] as const;

export const RESEARCH_UNSAFE_FOR_CORPUS = [
  "notion_append_section",
  "pc_run_shell",
  "build_terminal_run",
  "build_git_commit",
] as const;

export async function researchDeep(input: {
  query: string;
  endpoint?: string;
  key?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sitesAllowlist?: string[];
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const endpoint = input.endpoint ?? env.MIND_SEARCH_ENDPOINT?.trim();
  const key = input.key ?? env.MIND_SEARCH_KEY?.trim();
  const allowlist = input.sitesAllowlist ?? parseSitesAllowlist(env.MIND_RESEARCH_SITES_ALLOWLIST);

  if (!endpoint || !key) {
    return {
      ok: false,
      status: "needs-config",
      text: "No search provider is configured (MIND_SEARCH_ENDPOINT + MIND_SEARCH_KEY). Nothing was searched and no citations were created.",
    };
  }

  const result: ResearchResult = await performDeepResearch({
    query: input.query,
    endpoint,
    key,
    fetchImpl: input.fetchImpl,
    deepTimeoutMs: undefined,
  });

  if (!result.ok) {
    return {
      ok: false,
      status: result.configured ? "error" : "needs-config",
      text: result.error || "Deep research failed. No citations were created.",
      data: { steps: result.steps, citations: [] },
    };
  }

  const { kept, dropped } = filterCitationsBySitesAllowlist(result.citations, allowlist);
  if (!kept.length) {
    return {
      ok: false,
      status: "error",
      text: allowlist.length
        ? `Deep research returned sources, but none matched MIND_RESEARCH_SITES_ALLOWLIST (${dropped} dropped). No citations were kept.`
        : "Deep research returned no usable sources after filtering. No citations were created.",
      data: { steps: result.steps, citations: [], dropped, allowlist },
    };
  }

  const lines = [
    `Deep research kept ${kept.length} allowlisted http(s) source(s)` +
      (dropped ? ` (${dropped} outside Sites allowlist dropped)` : "") +
      ":",
    ...kept.map((c, i) => `${i + 1}. ${c.title} — ${c.url}`),
  ];
  return {
    ok: true,
    status: "ok",
    text: lines.join("\n"),
    data: { citations: kept, steps: result.steps, dropped, allowlist, partial: result.partial ?? false },
  };
}

/**
 * Read-only connector corpus for research. Only Notion page read is wired today.
 * Missing connector → clear refuse (no fake cites).
 */
export async function researchConnectorRead(input: {
  source: string;
  page_id?: string;
  ownerId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ToolResult> {
  const source = (input.source || "").trim().toLowerCase();
  if (source !== "notion") {
    return {
      ok: false,
      status: "error",
      text: `Research connector “${source || "(empty)"}” is not available as a read-only source. Supported: notion. Nothing was read.`,
    };
  }
  const pageId = (input.page_id || "").trim();
  if (!pageId) {
    return { ok: false, status: "error", text: "page_id is required for notion research reads. Nothing was read." };
  }
  const read = await notionReadPage({ pageIdOrUrl: pageId, ownerId: input.ownerId });
  if (!read.ok) {
    return {
      ok: false,
      status: read.status,
      text: read.text.includes("not configured")
        ? "Notion is not connected for research. Connect Notion OAuth or set NOTION_TOKEN. No citations were invented."
        : read.text,
    };
  }
  return {
    ok: true,
    status: "ok",
    text: read.text.slice(0, 8000),
    data: { source: "notion", pageId: (read.data as { pageId?: string } | undefined)?.pageId ?? null },
  };
}

/**
 * Optional allowlisted page fetch for research (SSRF-guarded).
 * Only https (or http localhost), DNS-pinned, private IPs refused, Sites allowlist required when set.
 */
export async function researchFetchAllowlistedUrl(input: {
  url: string;
  env?: NodeJS.ProcessEnv;
  lookup?: DnsLookupFn;
  fetchImpl?: typeof fetch;
}): Promise<ToolResult> {
  const env = input.env ?? process.env;
  const allowlist = parseSitesAllowlist(env.MIND_RESEARCH_SITES_ALLOWLIST);
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    return { ok: false, status: "error", text: "That is not a URL. Nothing was fetched." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, status: "error", text: "URLs with credentials are refused. Nothing was fetched." };
  }
  const local = isLocalHostname(parsed.hostname);
  if (!(parsed.protocol === "https:" || (parsed.protocol === "http:" && local))) {
    return { ok: false, status: "error", text: "Only https (or http on localhost) is allowed. Nothing was fetched." };
  }
  if (!local && isPrivateAddressLiteral(parsed.hostname)) {
    return { ok: false, status: "error", text: "Private/link-local addresses are refused. Nothing was fetched." };
  }
  if (!hostMatchesSitesAllowlist(parsed.hostname, allowlist)) {
    return {
      ok: false,
      status: "error",
      text: allowlist.length
        ? "That host is not on MIND_RESEARCH_SITES_ALLOWLIST. Nothing was fetched."
        : "Set MIND_RESEARCH_SITES_ALLOWLIST before fetching research pages. Nothing was fetched.",
    };
  }
  if (!allowlist.length) {
    return {
      ok: false,
      status: "needs-config",
      text: "MIND_RESEARCH_SITES_ALLOWLIST is empty; page fetch is disabled until Sites are configured. Nothing was fetched.",
    };
  }

  try {
    if (local) {
      const fetchImpl = input.fetchImpl ?? fetch;
      const response = await fetchImpl(parsed.toString(), {
        method: "GET",
        headers: { accept: "text/html,text/plain,*/*" },
        redirect: "manual",
      });
      if (!response.ok) {
        return { ok: false, status: "error", text: `Fetch returned ${response.status}. Nothing was invented.` };
      }
      const body = (await response.text()).slice(0, MAX_FETCH_BYTES);
      return {
        ok: true,
        status: "ok",
        text: body.slice(0, 4000) || "(empty body)",
        data: { url: parsed.toString(), bytes: Buffer.byteLength(body, "utf8") },
      };
    }
    const pin = await resolveAndPinMcpHostname(parsed.hostname, input.lookup ?? defaultDnsLookup);
    if (!pin.ok) {
      return { ok: false, status: "error", text: `${pin.error} Nothing was fetched.` };
    }
    const response = await pinnedHttpFetch(parsed, pin.pinnedAddress, pin.hostname, {
      method: "GET",
      headers: { accept: "text/html,text/plain,*/*" },
      redirect: "manual",
    });
    if (!response.ok) {
      return { ok: false, status: "error", text: `Fetch returned ${response.status}. Nothing was invented.` };
    }
    const body = (await response.text()).slice(0, MAX_FETCH_BYTES);
    return {
      ok: true,
      status: "ok",
      text: body.slice(0, 4000) || "(empty body)",
      data: { url: parsed.toString(), bytes: Buffer.byteLength(body, "utf8") },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed.";
    return { ok: false, status: "error", text: `${message} Nothing was invented.` };
  }
}
