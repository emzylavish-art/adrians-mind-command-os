import { hasDurableOAuthStore, readDurableConnection } from "../connectors/durable-oauth.server.ts";
import { notionGrantGeneration } from "../connectors/notion-operation-status.server.ts";
import { readConnection } from "../connectors/store.ts";
import { resolveOAuthAccessToken } from "../connectors/token-refresh.ts";
import { fetchNotionGraph } from "./notion.ts";

export async function readOwnerNotionGraph(ownerId: string, fetchImpl: typeof fetch = fetch) {
  const authorization = await resolveOAuthAccessToken({ ownerId, connector: "notion" });
  if (!authorization.ok) return { graph: null, summary: authorization.error };

  const graph = await fetchNotionGraph(authorization.token, fetchImpl);
  const selected = hasDurableOAuthStore()
    ? await readDurableConnection(ownerId, "notion")
    : readConnection(ownerId, "notion");
  const { grant } = authorization;
  if (!selected || selected.workspaceId !== grant.workspaceId ||
    notionGrantGeneration(selected) !== notionGrantGeneration(grant)) {
    return { graph: null, summary: "Your Notion connection changed during this check. Refresh to see the selected workspace." };
  }

  return { graph, summary: graph.reason || "Authorized Notion workspace" };
}
