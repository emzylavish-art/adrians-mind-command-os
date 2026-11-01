/** Sidebar Workspace route links that leave the in-app View shell (TanStack routes). */
export const WORKSPACE_ROUTE_LINKS = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    iconSrc: "/icons/dashboard.svg",
  },
] as const;

export type WorkspaceRouteLink = (typeof WORKSPACE_ROUTE_LINKS)[number];
