/** Authenticated app routes shown with the Workspace navigation. */
export const WORKSPACE_ROUTE_LINKS = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    iconSrc: "/icons/dashboard.svg",
  },
  {
    id: "explore",
    label: "Explore",
    href: "/explore",
    iconSrc: "/icons/research.svg",
  },
  {
    id: "research",
    label: "Research",
    href: "/research",
    iconSrc: "/icons/research.svg",
  },
  {
    id: "social",
    label: "Social",
    href: "/social",
    iconSrc: "/icons/systems.svg",
  },
  {
    id: "gpt-wrapper",
    label: "GPT wrapper",
    href: "/gpt-wrapper",
    iconSrc: "/icons/systems.svg",
  },
] as const;

export type WorkspaceRouteLink = (typeof WORKSPACE_ROUTE_LINKS)[number];
