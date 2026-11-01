import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  getSupabaseAuthUser,
  signInWithPassword,
  signUpWithPassword,
  startOAuth,
} from "@/lib/supabase/actions";
import { safeRedirectPath } from "@/lib/supabase/safe-redirect";

type LoginSearch = {
  next?: string;
  error?: string;
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === "string" ? search.next : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  loader: async () => {
    try {
      return await getSupabaseAuthUser();
    } catch {
      return { configured: false, user: null };
    }
  },
  component: Login,
});

type Mode = "sign-in" | "sign-up";

function Login() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const next = safeRedirectPath(search.next);
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(search.error ?? null);
  const [info, setInfo] = useState<string | null>(null);

  if (!data.configured) {
    return (
      <main className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
        <div className="w-full max-w-sm rounded-panel border border-line bg-surface p-6">
          <span className="logo-mark grid size-11 place-items-center rounded-2xl text-lg font-bold">
            A
          </span>
          <p className="mt-4 text-xs text-muted">Adrian's Mind</p>
          <h1 className="mt-1 font-display text-3xl font-bold">Sign in</h1>
          <div
            className="mt-4 rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm text-muted"
            role="status"
            data-testid="auth-not-configured"
          >
            Sign-in isn't configured yet. Connect Supabase to this Vercel
            project, then enable Google, GitHub, and Apple in the Supabase
            dashboard.
          </div>
          <Link
            to="/"
            className="mt-4 inline-flex min-h-11 items-center text-sm text-accent"
          >
            Back to the command page
          </Link>
        </div>
      </main>
    );
  }

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    setInfo(null);
    try {
      const action = mode === "sign-in" ? signInWithPassword : signUpWithPassword;
      const result = await action({
        data: { email, password, next },
      });
      if (result && "ok" in result && result.ok === false) {
        setBanner(result.error);
        return;
      }
      if (result && "needsConfirm" in result && result.needsConfirm) {
        setInfo(result.message);
        setMode("sign-in");
      }
    } catch (err) {
      // Successful redirects throw a redirect response; ignore those.
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      if (!/redirect/i.test(message)) {
        setBanner(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onOAuth(provider: "google" | "github" | "apple") {
    setBusy(true);
    setBanner(null);
    try {
      const result = await startOAuth({ data: { provider, next } });
      if (result && "ok" in result && result.ok === false) {
        setBanner(result.error);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      if (!/redirect/i.test(message)) {
        setBanner(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm rounded-panel border border-line bg-surface p-6">
        <span className="logo-mark grid size-11 place-items-center rounded-2xl text-lg font-bold">
          A
        </span>
        <p className="mt-4 text-xs text-muted">Adrian's Mind</p>
        <h1 className="mt-1 font-display text-3xl font-bold">
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Grok, voice, REA, and the server copy run only for the signed-in
          owner.
        </p>

        {banner && (
          <div
            className="mt-4 flex flex-wrap items-start justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-3"
            role="alert"
            data-testid="login-error-banner"
          >
            <p className="text-sm text-danger">{banner}</p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-panel border border-line px-3 text-sm"
              onClick={() => setBanner(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {info && (
          <div
            className="mt-4 rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm text-muted"
            role="status"
          >
            {info}
          </div>
        )}

        <form className="mt-4 flex flex-col gap-3" onSubmit={onPasswordSubmit}>
          <label className="block text-sm">
            <span className="text-muted">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-fg"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Password</span>
            <input
              type="password"
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "sign-up" ? 8 : 1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-fg"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-60"
          >
            {busy
              ? "Working…"
              : mode === "sign-in"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <button
          type="button"
          className="mt-3 text-sm text-muted underline-offset-4 hover:underline"
          onClick={() => {
            setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"));
            setBanner(null);
            setInfo(null);
          }}
        >
          {mode === "sign-in"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-2">
          {(
            [
              ["google", "Continue with Google"],
              ["github", "Continue with GitHub"],
              ["apple", "Continue with Apple"],
            ] as const
          ).map(([provider, label]) => (
            <button
              key={provider}
              type="button"
              disabled={busy}
              onClick={() => void onOAuth(provider)}
              className="min-h-11 rounded-panel border border-line bg-surface-2 px-4 text-sm font-semibold text-fg disabled:opacity-60"
            >
              {label}
            </button>
          ))}
        </div>

        <Link
          to="/"
          className="mt-4 inline-flex min-h-11 items-center text-sm text-accent"
        >
          Back to the command page
        </Link>
      </div>
    </main>
  );
}
