export const WORKSPACE_SHORTCUTS_KEY = "mind.workspace.shortcuts.v1";

export function readWorkspaceShortcuts(raw: string | null, allowed: readonly string[], defaults: readonly string[]): string[] {
  try {
    const stored: unknown = raw === null ? defaults : JSON.parse(raw);
    const ids: unknown[] = Array.isArray(stored) ? stored : [...defaults];
    return [...new Set(ids.filter((id): id is string => typeof id === "string" && allowed.includes(id)))];
  } catch {
    return [...defaults];
  }
}
