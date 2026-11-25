import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ownerConnections, type DashboardConnection } from "@/lib/mind/dashboard/owner-connections";

export function OwnerDashboard() {
  const { user, isPending } = useCurrentUserState();
  const [data, setData] = useState<{ connections: DashboardConnection[]; unavailable: string[] } | null>(null);
  const [failed, setFailed] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; setData(null); setFailed(false); void ownerConnections().then((value) => active && setData(value)).catch(() => active && setFailed(true)); return () => { active = false; }; }, [revision, user?.id]);
  return <section className="page-shell intelligence-main mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
    <div className="page-hero"><h1 className="font-display text-3xl font-bold">Dashboard</h1><p className="text-sm text-muted">Your connected services and workspaces. Private connection data is not shown in the public operations feed.</p></div>
    {isPending ? <p role="status">Checking your account…</p> : !user ? <a className="inline-flex min-h-11 items-center text-accent" href="/login?next=%2Fdashboard">Sign in to view your connections</a> : <>
      <div className="flex flex-wrap gap-3"><a className="inline-flex min-h-11 items-center text-accent" href="/?section=connected">Manage plugins and connections</a><button type="button" className="min-h-11 rounded-panel border border-line px-3" onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
      {failed ? <p role="alert">Your connections could not be loaded. Open Plugins to reconnect or review access.</p> : !data ? <p role="status">Checking your connections…</p> : <>{data.unavailable.length > 0 && <p role="status">Status unavailable for {data.unavailable.join(", ")}.</p>}{!data.connections.length && <p>No connections saved for this account.</p>}<ul className="grid gap-3 sm:grid-cols-2">{data.connections.map((item) => <li key={item.id} className="rounded-panel border border-line p-4"><p className="font-semibold">{item.name}</p>{item.detail && <p className="break-words text-sm">{item.detail}</p>}<p className="text-sm text-muted">{item.status}</p><a className="inline-flex min-h-11 items-center text-sm text-accent" href={`/?section=connected#connection-${encodeURIComponent(item.id)}`}>Manage {item.name}</a></li>)}</ul></>}
    </>}
  </section>;
}
