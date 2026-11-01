import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="login-shell grid place-items-center p-6 text-fg">
      <div className="login-card w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-3">
          <img src="/brand/logo-mark.jpg" alt="" className="logo-badge size-11 rounded-2xl object-cover" />
          <div>
            <p className="meta-label">Adrian&apos;s Mind</p>
            <h1 className="font-display text-3xl font-bold">Sign in</h1>
          </div>
        </div>
        <p className="text-sm text-muted">Grok, voice, REA, and the server copy run only for the signed-in owner.</p>
        <div className="mt-4 flex flex-col gap-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
              className="focus-ring min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
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
