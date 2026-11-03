/**
 * Deep-link helpers for the Bots & Agents shell (/bots, /agents).
 * Keeps path→view mapping out of the 6k-line command-app module.
 */

export const BOTS_SHELL_PATHS = ["/bots", "/agents"] as const;

export type BotsShellView = "agents";

export function viewFromBotsPath(pathname: string | null | undefined): BotsShellView | null {
  const path = typeof pathname === "string" ? pathname.replace(/\/+$/, "") || "/" : "";
  if (path === "/bots" || path === "/agents") return "agents";
  return null;
}

export function isBotsShellPath(pathname: string | null | undefined): boolean {
  return viewFromBotsPath(pathname) !== null;
}
