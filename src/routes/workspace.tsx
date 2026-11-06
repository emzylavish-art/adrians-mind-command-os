import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CommandApp } from "@/components/mind/command-app";
import { isMindOwnerId } from "@/lib/mind/dashboard/owner.server";

const requireWorkspaceUser = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSessionUser } = await import('@/lib/auth/verify.server');
  const user = await getSessionUser();

  if (!user) {
    throw redirect({ to: '/login', search: { next: '/workspace' } });
  }

  if (!(await isMindOwnerId(user.id))) {
    return { forbidden: true as const };
  }

  return {
    forbidden: false as const,
    sessionUser: { id: user.id, email: user.email },
  };
});

export const Route = createFileRoute('/workspace')({
  beforeLoad: async () => ({ access: await requireWorkspaceUser() }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const access = Route.useRouteContext().access;

  if (access.forbidden) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-fg">
        <h1 className="text-2xl font-semibold">Access denied</h1>
      </main>
    );
  }

  return <CommandApp />;
}
