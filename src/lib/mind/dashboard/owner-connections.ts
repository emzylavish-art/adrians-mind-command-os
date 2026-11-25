import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

export type DashboardConnection = { section: "tools" | "connected"; id: string; name: string; detail: string; status: string };

export const ownerConnections = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (context.userId === "dev-user") throw new Error("Sign in to see your connections.");
    const { CONNECTOR_IDS, CONNECTOR_DISPLAY_NAMES, readConnection } = await import("../connectors/store");
    const { hasDurableOAuthStore, readDurableConnection } = await import("../connectors/durable-oauth.server");
    const { listCustomConnections } = await import("../custom-connection");
    const { getSql } = await import("@/lib/db");
    const durable = hasDurableOAuthStore();
    const results = await Promise.allSettled(CONNECTOR_IDS.map(async (id): Promise<DashboardConnection | null> => {
      if (id === "notion") return null;
      const record = durable ? await readDurableConnection(context.userId, id) : readConnection(context.userId, id);
      if (!record) return null;
      return { section: "connected", id, name: CONNECTOR_DISPLAY_NAMES[id], detail: record.workspaceName || record.accountLabel || "", status: "Authorization saved" };
    }));
    const connections: DashboardConnection[] = [];
    const unavailable: string[] = [];
    results.forEach((result, i) => {
      if (result.status === "rejected") unavailable.push(CONNECTOR_DISPLAY_NAMES[CONNECTOR_IDS[i]]);
      else if (result.value) connections.push(result.value);
    });
    try {
      const { savedNotionWorkspaces } = await import("../connectors/notion-oauth");
      for (const space of await savedNotionWorkspaces(context.userId)) {
        connections.push({ section: "connected", id: "notion/" + space.id, name: "Notion", detail: space.name, status: space.active ? "Selected workspace" : "Authorization saved" });
      }
    } catch { unavailable.push("Notion"); }
    try {
      if (!durable) throw new Error("Missing connection storage");
      const custom = await listCustomConnections(await getSql(), context.userId);
      for (const row of custom) connections.push({ section: row.kind === "http" ? "tools" : "connected", id: row.id, name: row.label, detail: row.host, status: row.enabled === false ? "Disabled" : row.error ? "Needs attention" : row.state === "ready" ? "Last check passed" : row.state });
    } catch {
      unavailable.push("Custom connections");
    }
    return { connections, unavailable };
  });
