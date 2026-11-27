import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { embeddedWorkspaceSearch } from "@/lib/mind/app-location";

export function EmbeddedWorkspacePage({ title, src, workspace }: { title: string; src: string; workspace?: string }) {
  const { user, isPending, error } = useCurrentUserState();
  const returnTo = `/${embeddedWorkspaceSearch(workspace ?? "")}#mind-workspace`;
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 border-b border-line px-4">
        <a href={returnTo} className="inline-flex min-h-11 items-center text-sm font-medium underline focus-visible:outline-2">Back to workspace</a>
        <h1 className="text-sm font-semibold">{title}</h1>
      </header>
      {isPending ? <p className="p-4" role="status">Verifying your account…</p>
        : error ? <p className="p-4" role="alert">{error}</p>
        : <iframe key={JSON.stringify([user?.id, user?.sessionEpoch])} title={title} src={src} className="min-h-0 w-full flex-1 border-0 bg-bg" />}
    </main>
  );
}
