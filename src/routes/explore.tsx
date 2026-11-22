import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PersonaDirectoryView } from "@/components/mind/persona-directory";
import { emptyWorkspace, loadWorkspace } from "@/lib/mind/workspace";
import type { Workspace } from "@/lib/mind/types";

export const Route = createFileRoute("/explore")({ component: ExplorePage });

function ExplorePage() {
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

  if (!ready) {
    return (
      <main className="min-h-screen bg-bg p-6 text-fg">
          <Link
          to="/"
          className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm"
        >
          Back to Chat
        </Link>
        <p className="mt-4 text-sm text-muted">Loading local workspace…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <div className="mb-4 flex items-center gap-3">
          <img src="/brand/logo-mark.jpg" alt="" width={32} height={32} className="size-8 rounded-lg" />
          <div>
            <h1 className="text-3xl font-bold">Explore</h1>
            <p className="text-sm text-muted">Filter local templates, save one, then open it in Chat. Nothing here starts a remote bot.</p>
          </div>
        </div>
        <PersonaDirectoryView
          ws={ws}
          setWs={setWs}
        />
      </div>
    </main>
  );
}
