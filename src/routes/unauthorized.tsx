import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/unauthorized")({
  component: UnauthorizedPage,
});

function UnauthorizedPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg px-5 py-12 text-fg">
      <section className="w-full max-w-md rounded-panel border border-line bg-surface p-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Adrian&apos;s Mind</p>
        <h1 className="mt-3 font-display text-2xl font-bold">Not signed in</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">This page needs a signed-in account. No account data is shown here.</p>
        <Link to="/login" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink">Sign in</Link>
      </section>
    </main>
  );
}
