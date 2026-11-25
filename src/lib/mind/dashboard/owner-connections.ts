import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type DashboardConnection = { id: string; name: string; detail: string; status: string };

/** Account-scoped connection summary. Tokens, grants and private page data never leave the server. */
export const ownerConnections = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (context.userId === "dev-user") throw new Error("Sign in to see your connections.");
    const { CONNECTOR_IDS, CONNECTOR_DISPLAY_NAMES, readConnection } = await import("../connectors/store");
    const { hasDurableOAuthStore, readDurableConnection } = await import("../connectors/durable-oauth.server");
    const durable = hasDurableOAuthStore();
    const results = await Promise.allSettled(CONNECTOR_IDS.map(async (id): Promise<DashboardConnection | null> => {
      const record = durable ? await readDurableConnection(context.userId, id) : readConnection(context.userId, id);
      if (!record) return null;
      return { id, name: CONNECTOR_DISPLAY_NAMES[id], detail: record.workspaceName || record.accountLabel || "", status: id === "notion" && record.workspaceName ? "Workspace connected" : "Authorization saved" };
    }));
    const connections: DashboardConnection[] = []; const unavailable: string[] = [];
    results.forEach((result, index) => { if (result.status === "rejected") unavailable.push(CONNECTOR_DISPLAY_NAMES[CONNECTOR_IDS[index]]); else if (result.value) connections.push(result.value); });
    return { connections, unavailable };
  });
