/**
 * Shareable SPA deep-links → CommandApp View ids.
 * Keep /dashboard out (Dashboard Bot owns that route).
 */
export const COMMAND_DEEP_LINK_PATHS = [
  "/settings",
  "/library",
  "/projects",
  "/voice",
  "/connectors",
  "/artifacts",
  "/mcp",
  "/tools",
  "/chat",
  "/command",
  "/app",
] as const;

export type CommandDeepLinkPath = (typeof COMMAND_DEEP_LINK_PATHS)[number];

/** View ids accepted by CommandApp (subset used by deep links). */
export type CommandDeepLinkView =
  | "command"
  | "chat"
  | "projects"
  | "files"
  | "connected"
  | "tools"
  | "settings"
  | "integrations"
  | "help";

const PATH_TO_VIEW: Record<CommandDeepLinkPath, CommandDeepLinkView> = {
  "/settings": "settings",
  "/library": "files",
  "/projects": "projects",
  "/voice": "command",
  "/connectors": "connected",
  "/artifacts": "files",
  "/mcp": "tools",
  "/tools": "tools",
  "/chat": "chat",
  "/command": "command",
  "/app": "command",
};

export function viewForDeepLinkPath(pathname: string): CommandDeepLinkView | null {
  const path = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  if ((COMMAND_DEEP_LINK_PATHS as readonly string[]).includes(path)) {
    return PATH_TO_VIEW[path as CommandDeepLinkPath];
  }
  return null;
}
