import { DashboardApp } from "@/components/mind/dashboard-3d/dashboard-app";

/** Public read-only dashboard shell. No owner/session gate on this page. */
export function DashboardPage() {
  return <DashboardApp />;
}
