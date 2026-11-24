import { createFileRoute } from "@tanstack/react-router";
import { MemoryManagerView } from "@/components/mind/memory-manager";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useMindWorkspace } from "@/lib/mind/use-mind-workspace";

export const Route = createFileRoute("/memory")({ component: MemoryPage });

function MemoryPage() {
  const { user, isPending } = useCurrentUserState();
  const { ws, setWs, ready } = useMindWorkspace(user?.id ?? null, user?.emailVerified ? user.primaryEmail : null);

  if (isPending || !ready) {
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

  if (!user) {
    return <main className="min-h-screen bg-bg p-6 text-fg"><a href="/login" className="min-h-11 text-accent">Sign in to manage saved memory</a></main>;
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <MemoryManagerView
          key={user.id}
          ws={ws}
          setWs={setWs}
        />
      </div>
    </main>
  );
}
