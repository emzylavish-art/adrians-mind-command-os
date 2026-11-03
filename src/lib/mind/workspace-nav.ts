/** Sidebar Workspace route links that leave the in-app View shell (TanStack routes). */
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
    iconSrc: "/icons/bots.svg",
  },
  {
    id: "voice-cloning-studio",
    label: "Voice Cloning",
    href: "/voice-cloning-studio",
    iconSrc: "/icons/voice.svg",
  },
] as const;

export type WorkspaceRouteLink = (typeof WORKSPACE_ROUTE_LINKS)[number];
