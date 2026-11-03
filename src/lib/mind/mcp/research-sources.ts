/**
 * Research-layer helpers for Adrian's Mind MCP:
 * - Sites allowlist (ChatGPT Sites pattern) enforced server-side on citations
 * - Read-only connector corpus reads (Notion page + Google Drive file_id; never write tools)
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
import { findStorageAccountByLaneId, resolveStorageLaneAccessToken } from "../media/storage/lanes.ts";
import { loadStorageAccountsConfig } from "../media/storage/config.ts";

const MAX_ALLOWLIST = 64;
const MAX_FETCH_BYTES = 200_000;
const MAX_GDRIVE_READ_BYTES = 200_000;
const DEFAULT_GDRIVE_LANE = "gdrive-emzylavish";
const GDRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{10,128}$/;
/** Per-request timeout for Drive files.get / export / download (research must never hang). */
export const GDRIVE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Read at most `max + 1` bytes from a response body (streaming), then cancel.
 * Prevents a huge export/download from being fully buffered before the cap check.
 */
async function readBodyCapped(res: Response, max: number): Promise<{ buf: Uint8Array; overflow: boolean }> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > max ? { buf: buf.subarray(0, max), overflow: true } : { buf, overflow: false };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > max) {
        overflow = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    if (overflow) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { buf, overflow };
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

const GDRIVE_EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.drawing": "image/svg+xml",
};

function isPlainTextMime(mime: string): boolean {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  if (m.startsWith("text/")) return true;
  return m === "application/json" || m === "application/xml" || m === "application/javascript" || m === "image/svg+xml";
}

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
 * Read-only connector corpus for research.
 * Supported: notion (page_id), gdrive (file_id) via lane-aware OAuth.
 * Missing / invalid tokens → needs-config or needs-reconnect. Never writes.
 */
export async function researchConnectorRead(input: {
  source: string;
  page_id?: string;
  file_id?: string;
  lane_id?: string;
  ownerId?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  configPath?: string;
  timeoutMs?: number;
}): Promise<ToolResult> {
  const source = (input.source || "").trim().toLowerCase();
  if (source === "notion") {
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
          ? "Notion is not connected for research. On ServiceBoard click Setup/Connect for Notion (/api/mind/oauth/notion/start), or set NOTION_TOKEN / NOTION_API_KEY on the server. OAuth needs NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, NOTION_OAUTH_REDIRECT_URI, and CONNECTOR_TOKEN_SECRET. No citations were invented."
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

  if (source === "gdrive" || source === "google_drive") {
    return researchGdriveRead(input);
  }

  return {
    ok: false,
    status: "error",
    text: `Research connector “${source || "(empty)"}” is not available as a read-only source. Supported: notion, gdrive. Nothing was read.`,
  };
}

export async function researchGdriveRead(input: {
  file_id?: string;
  lane_id?: string;
  ownerId?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  configPath?: string;
  timeoutMs?: number;
}): Promise<ToolResult> {
  const fileId = (input.file_id || "").trim();
  if (!fileId) {
    return { ok: false, status: "error", text: "file_id is required for gdrive research reads. Nothing was read." };
  }
  if (!GDRIVE_FILE_ID_RE.test(fileId)) {
    return { ok: false, status: "error", text: "file_id is not a valid Google Drive file id. Nothing was read." };
  }

  const laneId = (input.lane_id || "").trim() || DEFAULT_GDRIVE_LANE;
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? GDRIVE_FETCH_TIMEOUT_MS;

  // Security: the lane must be a Google Drive lane. Otherwise a caller could pass
  // lane_id=dropbox-* / onedrive-* / box-* and we would send that provider's bearer
  // token to googleapis.com (cross-provider credential leak) and misreport "needs-reconnect".
  let laneAccount: ReturnType<typeof findStorageAccountByLaneId> = null;
  try {
    laneAccount = findStorageAccountByLaneId(laneId, loadStorageAccountsConfig(input.configPath));
  } catch {
    laneAccount = null;
  }
  if (laneAccount && laneAccount.service !== "google_drive") {
    return {
      ok: false,
      status: "error",
      text: `Lane “${laneId}” is a ${laneAccount.service} lane, not Google Drive. gdrive research reads only use google_drive lanes. Nothing was read and no token was sent.`,
      data: { source: "gdrive", laneId, statusKind: "wrong-lane-service" },
    };
  }

  const tokenResult = await resolveStorageLaneAccessToken(laneId, {
    env,
    fetch: fetchImpl,
    fallbackOwnerId: input.ownerId,
    configPath: input.configPath,
  });

  if (!tokenResult.ok) {
    const detail = tokenResult.detail || "Google Drive is not connected.";
    if (
      tokenResult.reason === "encrypted_only" ||
      /CONNECTOR_TOKEN_SECRET|could not be decrypted|missing.*client|needs-config/i.test(detail)
    ) {
      return {
        ok: false,
        status: "needs-config",
        text: `Google Drive lane “${laneId}” needs config: ${detail} Nothing was read.`,
        data: { source: "gdrive", laneId, statusKind: "needs-config" },
      };
    }
    if (
      tokenResult.reason === "refresh_failed" ||
      tokenResult.reason === "incomplete" ||
      /reconnect|expired|invalid|revoked|unauthorized/i.test(detail)
    ) {
      return {
        ok: false,
        status: "needs-reconnect",
        text: `Google Drive lane “${laneId}” needs reconnect: ${detail} Nothing was read.`,
        data: { source: "gdrive", laneId, statusKind: "needs-reconnect" },
      };
    }
    // Unknown lane / not_connected — still report honestly (config if lane missing from accounts).
    const config = loadStorageAccountsConfig(input.configPath);
    const hasLane = (config.accounts || []).some((a) => a.laneId === laneId);
    if (!hasLane) {
      return {
        ok: false,
        status: "needs-config",
        text: `Google Drive lane “${laneId}” is not configured in media-storage-accounts.json. Nothing was read.`,
        data: { source: "gdrive", laneId, statusKind: "needs-config" },
      };
    }
    return {
      ok: false,
      status: "needs-reconnect",
      text: `Google Drive lane “${laneId}” is not connected: ${detail} Nothing was read.`,
      data: { source: "gdrive", laneId, statusKind: "needs-reconnect" },
    };
  }

  const token = tokenResult.token;
  const metaUrl = new URL("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId));
  metaUrl.searchParams.set("fields", "id,name,mimeType,size,trashed");
  metaUrl.searchParams.set("supportsAllDrives", "true");

  let metaRes: Response;
  try {
    metaRes = await fetchImpl(metaUrl.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortLike(error)) {
      return { ok: false, status: "error", text: `Google Drive files.get timed out after ${timeoutMs}ms. Nothing was read.` };
    }
    return { ok: false, status: "error", text: "Google Drive metadata request failed (network error). Nothing was read." };
  }

  if (metaRes.status === 401 || metaRes.status === 403) {
    return {
      ok: false,
      status: "needs-reconnect",
      text: `Google Drive refused the token for lane “${laneId}” (HTTP ${metaRes.status}). Reconnect on ServiceBoard. Nothing was read.`,
      data: { source: "gdrive", laneId, statusKind: "needs-reconnect" },
    };
  }
  if (metaRes.status === 404) {
    return { ok: false, status: "error", text: "That Drive file was not found (or is outside this app's access). Nothing was read." };
  }
  if (!metaRes.ok) {
    return { ok: false, status: "error", text: `Google Drive files.get returned ${metaRes.status}. Nothing was read.` };
  }

  let metaJson: unknown;
  try {
    metaJson = await metaRes.json();
  } catch {
    return { ok: false, status: "error", text: "Google Drive files.get returned an unreadable response. Nothing was read." };
  }
  const meta = (metaJson ?? {}) as {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    trashed?: boolean;
  };
  if (meta.trashed) {
    return { ok: false, status: "error", text: "That Drive file is in trash. Nothing was read." };
  }
  const mime = (meta.mimeType || "application/octet-stream").toLowerCase();
  const name = meta.name || fileId;
  const sizeNum = meta.size != null ? Number(meta.size) : NaN;

  const exportMime = GDRIVE_EXPORT_MIME[mime];
  let bodyUrl: string;
  let via: "export" | "download";
  if (exportMime) {
    const u = new URL("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "/export");
    u.searchParams.set("mimeType", exportMime);
    bodyUrl = u.toString();
    via = "export";
  } else if (isPlainTextMime(mime)) {
    if (Number.isFinite(sizeNum) && sizeNum > MAX_GDRIVE_READ_BYTES) {
      return {
        ok: false,
        status: "error",
        text: `Drive file “${name}” is ${sizeNum} bytes; research reads cap at ${MAX_GDRIVE_READ_BYTES} bytes. Nothing was read.`,
        data: { source: "gdrive", fileId, name, mimeType: mime, size: sizeNum },
      };
    }
    const u = new URL("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId));
    u.searchParams.set("alt", "media");
    u.searchParams.set("supportsAllDrives", "true");
    bodyUrl = u.toString();
    via = "download";
  } else {
    return {
      ok: false,
      status: "error",
      text: `Drive file “${name}” has mimeType ${mime}, which is not a supported text export/download for research. Nothing was read.`,
      data: { source: "gdrive", fileId, name, mimeType: mime },
    };
  }

  let bodyRes: Response;
  try {
    bodyRes = await fetchImpl(bodyUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "text/plain,text/*,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortLike(error)) {
      return { ok: false, status: "error", text: `Google Drive ${via} timed out after ${timeoutMs}ms. Nothing was read.` };
    }
    return { ok: false, status: "error", text: `Google Drive ${via} request failed (network error). Nothing was read.` };
  }

  if (bodyRes.status === 401 || bodyRes.status === 403) {
    return {
      ok: false,
      status: "needs-reconnect",
      text: `Google Drive refused content access for lane “${laneId}” (HTTP ${bodyRes.status}). Reconnect on ServiceBoard. Nothing was read.`,
      data: { source: "gdrive", laneId, statusKind: "needs-reconnect" },
    };
  }
  if (!bodyRes.ok) {
    return { ok: false, status: "error", text: `Google Drive ${via} returned ${bodyRes.status}. Nothing was read.` };
  }

  // Stream at most MAX bytes; cancel the body as soon as the cap is exceeded.
  let buf: Uint8Array;
  try {
    const capped = await readBodyCapped(bodyRes, MAX_GDRIVE_READ_BYTES);
    if (capped.overflow) {
      return {
        ok: false,
        status: "error",
        text: `Drive ${via} for “${name}” exceeded the ${MAX_GDRIVE_READ_BYTES}-byte research cap. Nothing was kept.`,
        data: { source: "gdrive", fileId, name, mimeType: mime, capBytes: MAX_GDRIVE_READ_BYTES },
      };
    }
    buf = capped.buf;
  } catch (error) {
    if (isAbortLike(error)) {
      return { ok: false, status: "error", text: `Google Drive ${via} timed out after ${timeoutMs}ms while reading. Nothing was read.` };
    }
    return { ok: false, status: "error", text: `Google Drive ${via} body could not be read. Nothing was read.` };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const preview = text.slice(0, 8000);
  return {
    ok: true,
    status: "ok",
    text: preview || "(empty file)",
    data: {
      source: "gdrive",
      fileId: meta.id || fileId,
      name,
      mimeType: mime,
      via,
      bytes: buf.byteLength,
      laneId,
      truncated: text.length > 8000,
    },
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
