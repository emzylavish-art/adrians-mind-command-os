import type { RegistryRecord } from "../mcp/registry-store.ts";
import type { StoredConnection } from "./store.ts";

export const vercelResource = "https://mcp.vercel.com/";
export const vercelRegistryPrefix = "oauth-vercel-";

export function vercelMcpRecord(grant: StoredConnection): RegistryRecord {
  if (grant.connector !== "vercel" || !grant.grantGeneration) throw new Error("Vercel OAuth grant required.");
  return { id: vercelRegistryPrefix + grant.grantGeneration, kind: "http", protocol: "mcp", label: "Vercel",
    url: vercelResource, enabled: true, state: "unchecked", operations: [] };
}

/** The delegated bearer may travel only to the same grant's reviewed Vercel origin and path. */
export async function vercelMcpCredential(owner: string, row: RegistryRecord) {
  if (!row.id.startsWith(vercelRegistryPrefix)) return { ok: true as const, token: row.token ?? "" };
  if (row.url !== vercelResource || row.kind !== "http" || row.protocol !== "mcp") {
    return { ok: false as const, error: "The Vercel connection address changed. Reconnect Vercel." };
  }
  const { resolveOAuthAccessToken } = await import("./token-refresh.ts");
  const credential = await resolveOAuthAccessToken({ ownerId: owner, connector: "vercel" });
  if (!credential.ok) return credential;
  if (row.id !== vercelRegistryPrefix + credential.grant.grantGeneration) return { ok: false as const, error: "The Vercel authorization changed. Refresh this connection." };
  return { ok: true as const, token: credential.token };
}
