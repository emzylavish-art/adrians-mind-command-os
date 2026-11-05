/** Sidebar Workspace links stay intentionally small; all remaining views are grouped in Settings. */
export const SIDEBAR_WORKSPACE_NAV_IDS = ["files", "projects", "scheduled"] as const;
export const SIDEBAR_WORKSPACE_ROUTE_IDS = ["explore"] as const;

/** Routes that are part of the authenticated app shell (TanStack routes). */
export const WORKSPACE_ROUTE_LINKS = [
  {
    id: "explore",
    label: "Explore",
    href: "/explore",
    iconSrc: "/icons/research.svg",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    iconSrc: "/icons/dashboard.svg",
  },
] as const;

export type WorkspaceRouteLink = (typeof WORKSPACE_ROUTE_LINKS)[number];

export function isSidebarWorkspaceRoute(id: string): boolean {
  return (SIDEBAR_WORKSPACE_ROUTE_IDS as readonly string[]).includes(id);
}
