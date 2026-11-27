export const PLUGIN_SELECTION_KEY = "adrian-added-plugins";
export type PluginSelection = { id: string; enabled: boolean; connectionId?: string };
export type PluginCapability = { name: string; permission: "instructions" | "read" | "write" | "unknown" };
export type PluginConnectionEvidence = { id: string; state: string; enabled?: boolean; error?: string; tools: { name: string; permission?: "read" | "write" | "unknown" }[] };
export type PluginReadiness = { state: "available" | "setup_required" | "ready" | "unavailable" | "disabled"; capabilities: PluginCapability[]; detail: string };

export function readPluginSelections(raw: string | null): PluginSelection[] {
  try {
    const items: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(items)) return [];
    return items.flatMap(item => {
      // Account-scoped legacy bookmark arrays never become verified integrations.
      if (typeof item === "string") return [{ id: item, enabled: true }];
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.enabled !== "boolean") return [];
      return [{ id: row.id, enabled: row.enabled, ...(typeof row.connectionId === "string" ? { connectionId: row.connectionId } : {}) }];
    });
  } catch { return []; }
}

export function pluginReadiness(kind: "instructions" | "mcp", selection?: PluginSelection, connection?: PluginConnectionEvidence): PluginReadiness {
  const instruction = [{ name: "External documentation; not installed in the execution environment", permission: "instructions" as const }];
  if (!selection) return { state: "available", capabilities: kind === "instructions" ? instruction : [], detail: "Available in the catalogue; no authorization or runtime is established." };
  if (!selection.enabled || connection?.enabled === false) return { state: "disabled", capabilities: [], detail: "Disabled for future application in Adrian. External software is unchanged." };
  if (kind === "instructions") return { state: "setup_required", capabilities: instruction, detail: "Bookmarked instructions. Opening the source does not install or apply them. Review and activate instructions in Skills." };
  if (!selection.connectionId) return { state: "setup_required", capabilities: [], detail: "Select and configure an account-owned MCP connection before use." };
  if (!connection || connection.id !== selection.connectionId || connection.state !== "connected" || connection.error || !connection.tools.length) return { state: "unavailable", capabilities: [], detail: connection?.error || "The saved connection has no currently usable tool metadata. Refresh or reconnect the same destination explicitly." };
  return { state: "ready", capabilities: connection.tools.map(tool => ({ name: tool.name, permission: tool.permission || "unknown" })), detail: "Compatible tool schemas are saved. This is not proof that a tool action succeeded. Each external action still requires review." };
}

export function pluginMayDispatch(selection: PluginSelection | undefined, connection: PluginConnectionEvidence | undefined): boolean {
  return pluginReadiness("mcp", selection, connection).state === "ready";
}
