import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Mind — Your focused workspace' },
      {
        name: 'description',
        content: 'A focused workspace for turning ideas into clear next steps. Sign in to access your private workspace.',
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-surface focus:p-3">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-6">
        <a href="/" className="text-xl font-bold" aria-label="Mind home">Mind</a>
        <a href="/login?next=%2Fworkspace" className="rounded-lg border border-current px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
          Sign in
        </a>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <section aria-labelledby="hero-title" className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest">Less noise. More focus.</p>
          <h1 id="hero-title" className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Make room for your next clear step.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed">
            Bring your ideas and daily work into one focused workspace. Spend less time switching contexts and more time moving forward.
          </p>
          <a href="/login?next=%2Fworkspace" className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-6 py-3 font-semibold text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
            Open your workspace
          </a>
          <p className="mt-3 text-sm">Sign in to continue. Workspace access is restricted to authorized users.</p>
        </section>
        <section aria-labelledby="benefits-title" className="mt-20">
          <h2 id="benefits-title" className="text-2xl font-semibold">A simpler place to work</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <article className="rounded-xl bg-surface p-6">
              <h3 className="text-lg font-semibold">Find your focus</h3>
              <p className="mt-3 leading-relaxed">Keep your attention on the work that matters right now.</p>
            </article>
            <article className="rounded-xl bg-surface p-6">
              <h3 className="text-lg font-semibold">Keep moving</h3>
              <p className="mt-3 leading-relaxed">Turn open questions into practical next steps.</p>
            </article>
            <article className="rounded-xl bg-surface p-6">
              <h3 className="text-lg font-semibold">Return with clarity</h3>
              <p className="mt-3 leading-relaxed">Give your work a dedicated home, ready when you are.</p>
            </article>
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-6 py-8 text-sm">Mind — A focused place for your work.</footer>
    </div>
  );
}
