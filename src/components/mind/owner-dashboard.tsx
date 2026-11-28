import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ownerConnections, type DashboardConnection } from "@/lib/mind/dashboard/owner-connections";

function ConnectionList() {
  const [snapshot, setSnapshot] = useState<{ connections: DashboardConnection[]; unavailable: string[] } | null>(null);
  const [failure, setFailure] = useState<"auth" | "error" | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFailure(null);
    setSnapshot(null);
    void ownerConnections().then((value) => { if (active) setSnapshot(value); })
      .catch((error: unknown) => {
        if (active) setFailure(error instanceof Error && /unauthorized|sign in/i.test(error.message) ? "auth" : "error");
      });
    return () => { active = false; };
  }, [revision]);
  if (failure === "auth") return <a className="inline-flex min-h-11 items-center text-accent" href="/login?next=%2Fdashboard">Sign in to view your connections</a>;
  return <>
    <div className="flex flex-wrap items-center gap-4">
      <a className="inline-flex min-h-11 items-center text-accent" href="/?section=connected">Manage plugins and connections</a>
      <button className="min-h-11 text-sm" onClick={() => setRevision((n) => n + 1)}>Refresh</button>
    </div>
    {failure ? <p role="alert">Your connections could not be loaded.</p> : !snapshot ? <p role="status">Checking your connections…</p> : <>
      {snapshot.unavailable.length > 0 && <p role="status">Status unavailable for {snapshot.unavailable.join(", ")}.</p>}
      {!snapshot.unavailable.length && !snapshot.connections.length && <p>No connections saved for this account.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">{snapshot.connections.map((row) => <li key={row.id} className="rounded-panel border border-line p-4">
        <p className="font-semibold">{row.name}</p>
        {row.detail && <p className="break-words text-sm">{row.detail}</p>}
        <p className="text-sm text-muted">{row.status}</p>
        <a className="inline-flex min-h-11 items-center text-sm text-accent" href={`/?section=${row.section}#connection-${encodeURIComponent(row.id.startsWith("notion/") ? "notion" : row.id)}`}>Manage {row.name}</a>
      </li>)}</ul>
    </>}
  </>;
}

export function OwnerDashboard() {
  const { user, isPending } = useCurrentUserState();
  return <section className="mx-auto max-w-5xl space-y-3 p-4 md:p-6">
    <h2 className="text-lg font-semibold">Your connections and workspaces</h2>
    {isPending ? <p role="status">Checking your account…</p> : <ConnectionList key={user?.id || "session"} />}
  </section>;
}
