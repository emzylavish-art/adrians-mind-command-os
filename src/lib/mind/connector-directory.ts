export type RemoteListing = {
  id: string;
  title: string;
  description: string;
  website: string;
  logo: string;
  endpoints: string[];
};

export type ApiListing = {
  id: string;
  title: string;
  category: string;
  logo: string;
  specification: string;
};

export const registryOrigin = "https://registry.modelcontextprotocol.io";
export const curatedConnectors = [
  { title: "Supabase", keywords: "superbase database postgres", logo: "supabase", description: "Inspect database projects with a scoped access token.", endpoint: "https://mcp.supabase.com/mcp?read_only=true", website: "https://supabase.com/docs/guides/ai-tools/mcp" },
  { title: "Vercel", keywords: "hosting deployments web", logo: "vercel", description: "Browse deployments and projects. Vercel requires an OAuth client.", endpoint: "", website: "https://vercel.com/docs/agent-resources/vercel-mcp" },
  { title: "Cloudflare", keywords: "workers DNS R2 developer", logo: "cloudflare", description: "Access account tools using a scoped Cloudflare API token.", endpoint: "https://mcp.cloudflare.com/mcp", website: "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/" },
  { title: "OpenAI API", keywords: "chatgpt models api key model provider", logo: "openai", description: "Choose a model using your OpenAI API account.", endpoint: "", website: "https://platform.openai.com/api-keys" },
  { title: "GitHub", keywords: "git repository source control branches pull requests", logo: "github", description: "Grant access to selected repositories and review what the account can read or change.", endpoint: "", website: "https://docs.github.com/apps/oauth-apps" },
  { title: "Notion", keywords: "workspace pages knowledge productivity", logo: "notion", description: "Select a Notion workspace and authorize the pages you want to use.", endpoint: "", website: "https://developers.notion.com/docs/authorization" },
] as const;

export function registryPageUrl(query: string, cursor = "") {
  query = query.trim().replace(/\bsuperbase\b/gi, "supabase");
  const url = new URL("/v0.1/servers", registryOrigin);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", "20");
  if (query.trim()) url.searchParams.set("search", query.trim().slice(0, 200));
  if (cursor) url.searchParams.set("cursor", cursor);
  return url;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function publicUrl(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 2048 || /[{}]/.test(raw)) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function registryLogo(raw: unknown, id: string) {
  if (!Array.isArray(raw)) return "";
  const namespace = id.split("/")[0].split(".").reverse().join(".").toLowerCase();
  for (const entry of raw) {
    const src = publicUrl(record(entry).src);
    if (!src) continue;
    const host = new URL(src).hostname;
    const publisherHosted = namespace.includes(".") && (host === namespace || host.endsWith("." + namespace));
    const assetHost = ["raw.githubusercontent.com", "avatars.githubusercontent.com", "cdn.jsdelivr.net", "github.com"].includes(host);
    if (publisherHosted || assetHost) return src;
  }
  return "";
}

export function parseRegistryPage(value: unknown): { items: RemoteListing[]; cursor: string } {
  const response = record(value);
  if (!Array.isArray(response.servers)) throw new Error("Invalid registry response");
  const items: RemoteListing[] = [];
  for (const item of response.servers) {
    const entry = record(item);
    const meta = record(record(entry._meta)["io.modelcontextprotocol.registry/official"]);
    const server = record(entry.server);
    const id = text(server.name, 255);
    if (!id || meta.status !== "active" || meta.isLatest === false) continue;
    const endpoints = new Set<string>();
    for (const remote of Array.isArray(server.remotes) ? server.remotes : []) {
      const { type, url, headers } = record(remote);
      const endpoint = publicUrl(url);
      // MindOS's connection form supports HTTPS and an optional bearer credential.
      const unsupportedHeaders = Array.isArray(headers) && headers.some(h => record(h).isRequired === true && String(record(h).name).toLowerCase() !== "authorization");
      if (type === "streamable-http" && endpoint && !unsupportedHeaders) endpoints.add(endpoint);
    }
    items.push({
      id, title: text(server.title, 160) || id, description: text(server.description, 320),
      website: publicUrl(server.websiteUrl) || publicUrl(record(server.repository).url),
      logo: registryLogo(server.icons, id), endpoints: [...endpoints],
    });
  }
  return { items, cursor: text(record(response.metadata).nextCursor, 600) };
}
