import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { ownerNotionGraph } from "@/lib/mind/dashboard/owner-connections";
import type { NotionGraph } from "@/lib/mind/dashboard/notion-graph-core";

type Snapshot = { scope: string; revision: number; graph: NotionGraph | null; summary: string };

export function useWorkspaceGraph() {
  const { user, isPending } = useCurrentUserState();
  const ownerId = !isPending && user && !user.isDevFallback ? user.id : null;
  const scope = ownerId ? JSON.stringify([ownerId, user?.sessionEpoch]) : null;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!ownerId || !scope) {
      setSnapshot(null);
      return;
    }
    let active = true;
    let loading = false;
    async function load() {
      if (loading || document.hidden || !scope) return;
      loading = true;
      try {
        const result = await ownerNotionGraph();
        if (!active) return;
        if (result.ownerId !== ownerId) {
          setSnapshot({ scope, revision, graph: null, summary: "Account verification changed. Refresh Notion to check this workspace." });
          return;
        }
        setSnapshot({ scope, revision, graph: result.graph, summary: result.summary });
      } catch {
        if (active) setSnapshot({ scope, revision, graph: null, summary: "Your private Notion graph could not be loaded." });
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = window.setInterval(load, 90_000);
    document.addEventListener("visibilitychange", load);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [ownerId, scope, revision]);

  const current = scope && snapshot?.scope === scope && snapshot.revision === revision ? snapshot : null;
  return {
    scope,
    graph: current?.graph ?? null,
    summary: current?.summary ?? (scope ? "Checking your Notion workspace…" : ""),
    checking: Boolean(scope && !current),
    refresh: () => setRevision((previous) => previous + 1),
  };
}
