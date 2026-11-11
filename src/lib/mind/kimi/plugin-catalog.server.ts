import { getSql } from "../../db.ts";
import { decryptSecret } from "../connectors/crypto.ts";

const MARKETPLACE = "https://code.kimi.ai/kimi-code/plugins/marketplace";

export type KimiPluginCard = {
  id: string;
  name: string;
  description: string;
  source: string;
};

export async function listKimiPlugins(ownerId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; plugins: KimiPluginCard[] } | { ok: false; error: string }> {
  const sql = await getSql();
  const rows = await sql.query<{ access_token_enc: string }>(
    "SELECT access_token_enc FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2",
    [ownerId, "kimi"],
  );
  const token = rows[0] ? decryptSecret(rows[0].access_token_enc) : "";
  if (!token) return { ok: false, error: "Connect Kimi Code first. Plugins are loaded from Kimi's own catalog." };
  const response = await fetchImpl(MARKETPLACE, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "kimi-code-cli/2.5.3" },
  });
  if (!response.ok) return { ok: false, error: "Kimi's plugin catalog did not load. The login is saved, but the catalog was refused." };
  const body = (await response.json().catch(() => ({}))) as { plugins?: unknown };
  const plugins = Array.isArray(body.plugins) ? body.plugins : [];
  return {
    ok: true,
    plugins: plugins.slice(0, 40).map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const id = typeof row.id === "string" ? row.id : "";
      return {
        id,
        name: typeof row.displayName === "string" ? row.displayName : id || "Plugin",
        description: typeof row.description === "string" ? row.description : "",
        source: typeof row.source === "string" ? row.source : "",
      };
    }).filter((item) => item.id || item.name),
  };
}
