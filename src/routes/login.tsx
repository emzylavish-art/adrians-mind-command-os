import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm rounded-panel border border-line bg-surface p-6">
        <p className="text-xs text-muted">Adrian's Mind</p>
        <h1 className="mt-1 font-display text-3xl font-bold">Sign in</h1>
        <p className="mt-2 text-sm text-muted">Grok, voice, REA, and the server copy run only for the signed-in owner.</p>
        <div className="mt-4 flex flex-col gap-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
              className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
            >
              Continue with {provider.label}
            </button>
          ))}
        </div>
        <Link to="/" className="mt-4 inline-flex min-h-11 items-center text-sm text-accent">
          Back to the command page
        </Link>
      </div>
    </main>
  );
}
