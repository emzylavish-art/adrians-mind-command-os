/**
 * Paperclip read-only bridge. An *actual* connected Paperclip service is
 * required: neither repo agent templates nor GitHub CI mean agents are alive.
 *
 * Endpoint contract verified against paperclipai/paperclip:
 * GET /api/health
 * GET /api/companies/:companyId/agents
 * GET /api/companies/:companyId/heartbeat-runs?summary=true&limit=25
 *
 * Never expose the Paperclip board key or accept an arbitrary user URL.
 */
import {
  pinnedHttpFetch,
  resolveAndPinMcpHostname,
  type ResolvePinResult,
} from "./mcp/http-dns-pin.ts";

export type PaperclipAgentPublic = {
  id: string; name: string; role: string; status: string;
};
export type PaperclipRunPublic = {
  id: string; agentId: string; status: string; startedAt: string | null; finishedAt: string | null;
};
export type PaperclipSnapshot = {
  state: "not_configured" | "unavailable" | "connected";
  message: string;
  checkedAt: string;
  agents: PaperclipAgentPublic[];
  runs: PaperclipRunPublic[];
};

type SafeResponse = { ok: boolean; status: number; text: () => Promise<string> };
type RequestFn = (url: URL, ip: string, host: string, init: RequestInit) => Promise<SafeResponse>;
type PinFn = (host: string) => Promise<ResolvePinResult>;

const NO_AGENT_RUNTIME = "No Paperclip service has been verified. Agent templates are not live agents.";
/** A globally configured Paperclip company is never visible to all app users.
 * Only the explicitly bound Adrian's Mind owner may query its agent roster.
 */
export function paperclipOwnerAllowed(userId: string, env: Record<string, string | undefined>): boolean {
  const configuredOwner = env.PAPERCLIP_OWNER_USER_ID?.trim() || "";
  return configuredOwner.length > 0 && configuredOwner === userId;
}

export function paperclipConfig(env: Record<string, string | undefined>): {
  base: URL; key: string; companyId: string;
} | null {
  const raw = env.PAPERCLIP_API_URL?.trim();
  const key = env.PAPERCLIP_API_KEY?.trim();
  const companyId = env.PAPERCLIP_COMPANY_ID?.trim();
  if (!raw || !key || !companyId || !/^[a-zA-Z0-9_-]{4,100}$/.test(companyId)) return null;
  let base: URL;
  try { base = new URL(raw); } catch { return null; }
  if (base.protocol !== "https:" || base.username || base.password || base.search ||
      base.hash || !["", "/"].includes(base.pathname) ||
      base.hostname.toLowerCase() === "localhost" ||
      base.hostname.endsWith(".local")) return null;
  return { base, key, companyId };
}

const fail = (state: PaperclipSnapshot["state"], message: string): PaperclipSnapshot =>
  ({ state, message, agents: [], runs: [], checkedAt: new Date().toISOString() });

async function getJson(
  url: URL,
  config: { key: string },
  ip: string,
  hostname: string,
  request: RequestFn,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  try {
    const result = await request(url, ip, hostname, {
      method: "GET", redirect: "error",
      headers: { accept: "application/json", authorization: "Bearer " + config.key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) return { ok: false, status: result.status };
    const raw = await result.text();
    if (raw.length > 600_000) return { ok: false, status: 502 };
    try { return { ok: true, value: JSON.parse(raw) as unknown }; }
    catch { return { ok: false, status: 502 }; }
  } catch {
    return { ok: false, status: 502 };
  }
}

export async function getPaperclipSnapshot(
  env: Record<string, string | undefined> = process.env,
  deps: { pin?: PinFn; request?: RequestFn } = {},
): Promise<PaperclipSnapshot> {
  const config = paperclipConfig(env);
  if (!config) return fail("not_configured", NO_AGENT_RUNTIME);
  const pinFn = deps.pin ?? resolveAndPinMcpHostname;
  const requestFn = deps.request ?? pinnedHttpFetch;
  const pinned = await pinFn(config.base.hostname);
  if (!pinned.ok) return fail("unavailable", "Paperclip server could not be reached through a permitted public HTTPS host.");

  const root = config.base.origin;
  const health = await getJson(new URL("/api/health", root), config, pinned.pinnedAddress, pinned.hostname, requestFn);
  if (!health.ok || !health.value || typeof health.value !== "object" ||
      (health.value as { status?: unknown }).status !== "ok") {
    return fail("unavailable", "Paperclip health check failed. No agents were marked as live.");
  }
  const company = encodeURIComponent(config.companyId);
  const agentsResult = await getJson(new URL("/api/companies/" + company + "/agents", root), config, pinned.pinnedAddress, pinned.hostname, requestFn);
  const runsResult = await getJson(new URL("/api/companies/" + company + "/heartbeat-runs?summary=true&limit=25", root), config, pinned.pinnedAddress, pinned.hostname, requestFn);
  if (!agentsResult.ok || !runsResult.ok ||
      !Array.isArray(agentsResult.value) || !Array.isArray(runsResult.value)) {
    return fail("unavailable", "Paperclip agent or heartbeat access was refused or returned invalid data.");
  }
  const agents: PaperclipAgentPublic[] = agentsResult.value
    .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw))
    .filter((raw) => typeof raw.id === "string" && typeof raw.name === "string")
    .slice(0, 100)
    .map((raw) => ({
      id: String(raw.id).slice(0, 100),
      name: String(raw.name).slice(0, 120),
      role: typeof raw.role === "string" ? raw.role.slice(0, 80) : "",
      status: typeof raw.status === "string" ? raw.status.slice(0, 80) : "unknown",
    }));
  const runs: PaperclipRunPublic[] = runsResult.value
    .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw))
    .filter((raw) => typeof raw.id === "string" && typeof raw.agentId === "string")
    .slice(0, 25)
    .map((raw) => ({
      id: String(raw.id).slice(0, 100),
      agentId: String(raw.agentId).slice(0, 100),
      status: typeof raw.status === "string" ? raw.status.slice(0, 80) : "unknown",
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt.slice(0, 40) : null,
      finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt.slice(0, 40) : null,
    }));
  return {
    state: "connected",
    message: "Paperclip API verified. Agent and heartbeat records were retrieved from the configured company.",
    checkedAt: new Date().toISOString(), agents, runs,
  };
}
