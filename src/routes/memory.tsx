import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MemoryManagerView } from "@/components/mind/memory-manager";
import { emptyWorkspace, loadWorkspace, WORKSPACE_KEY } from "@/lib/mind/workspace";
import type { Workspace } from "@/lib/mind/types";

export const Route = createFileRoute("/memory")({ component: MemoryPage });

function MemoryPage() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setWs(loadWorkspace(localStorage));
    } catch {
      setWs(emptyWorkspace());
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(ws));
      } catch {
        /* ignore quota */
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [ready, ws]);

  if (!ready) {
    return (
      <main className="min-h-screen bg-bg p-6 text-fg">
        <a
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm"
        >
          Back to Chat
        </a>
        <p className="mt-4 text-sm text-muted">Loading local workspace…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <MemoryManagerView
          ws={ws}
          setWs={(updater) => setWs((prev) => updater(prev))}
        />
      </div>
    </main>
  );
}
