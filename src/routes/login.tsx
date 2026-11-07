import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  getSupabaseAuthUser,
  signInWithPassword,
  signUpWithPassword,
  startOAuth,
} from "@/lib/supabase/actions";
import { safeRedirectPath } from "@/lib/supabase/safe-redirect";
import { oauthAuthorizeTarget } from "@/lib/supabase/oauth-redirect";
import { authEnabled, authClient, signIn } from "@/lib/auth/client";
import { emailAndPasswordEnabled } from "@/lib/auth/email-password";
import {
  emailPasswordGate,
  LOGIN_LAST_OAUTH_PROVIDER_KEY,
  loginCallbackFailureKind,
  loginErrorBannerFromSearch,
  resolveLoginProviderAction,
  type LoginCallbackFailureKind,
  type LoginProviderId,
} from "@/lib/auth/login-providers";

const LazyMonoMotion = lazy(() =>
  import("@/components/mind/motion/MonoMotionGraphic").then((m) => ({ default: m.MonoMotionGraphic })),
);

type LoginSearch = {
  next?: string;
  error?: string;
  mode?: Mode;
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    next: typeof search.next === "string" ? search.next : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    mode: search.mode === "sign-up" ? "sign-up" : undefined,
  }),
  loader: async () => {
    try {
      return await getSupabaseAuthUser();
    } catch {
      // Keep shape aligned with AuthUserResult so broker Google/X stays gated.
      return { configured: false, user: null, brokerConfigured: false, supabaseOAuthProviders: [] };
    }
  },
  component: Login,
});

type Mode = "sign-in" | "sign-up";

const inputClassName =
  "mt-1.5 min-h-11 w-full rounded-panel border border-line bg-bg px-3.5 text-[15px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-fg/35 focus:ring-2 focus:ring-fg/20 disabled:opacity-60";

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[22.5rem] rounded-panel border border-line bg-surface p-7 shadow-[0_24px_64px_rgb(0_0_0_/_0.45)]">
      {children}
    </div>
  );
}

function AuthBrand({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-3">
      <span className="logo-mark grid size-11 place-items-center rounded-2xl text-lg font-bold tracking-tight">
        A
      </span>
      <Suspense fallback={null}>
        <LazyMonoMotion className="mt-1" />
      </Suspense>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
          Adrian&apos;s Mind
        </p>
        <h1 className="mt-1.5 font-display text-[1.75rem] font-bold leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
        ) : null}
      </div>
    </header>
  );
}

function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V1C5.373 1 1 5.373 1 12h3zm2 5.291A7.962 7.962 0 014 12H1c0 3.042 1.135 5.824 3 7.938l2-2.647z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        opacity="0.9"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        opacity="0.75"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        opacity="0.85"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        opacity="0.95"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 1.5C6.2 1.5 1.5 6.24 1.5 12.1c0 4.68 2.99 8.65 7.14 10.05.52.1.71-.23.71-.51 0-.25-.01-1.08-.02-1.96-2.9.64-3.52-1.42-3.52-1.42-.47-1.22-1.16-1.55-1.16-1.55-.95-.66.07-.65.07-.65 1.05.08 1.6 1.1 1.6 1.1.93 1.62 2.45 1.15 3.05.88.09-.69.36-1.15.66-1.42-2.32-.27-4.76-1.18-4.76-5.26 0-1.16.4-2.11 1.07-2.86-.11-.27-.46-1.37.1-2.85 0 0 .87-.28 2.85 1.09a9.7 9.7 0 012.6-.36c.88 0 1.77.12 2.6.36 1.97-1.37 2.84-1.09 2.84-1.09.57 1.48.21 2.58.1 2.85.67.75 1.07 1.7 1.07 2.86 0 4.09-2.45 4.98-4.78 5.24.37.33.71.97.71 1.96 0 1.42-.01 2.56-.01 2.91 0 .28.19.62.72.51A10.62 10.62 0 0022.5 12.1C22.5 6.24 17.8 1.5 12 1.5z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.365 1.43c0 1.14-.47 2.2-1.23 2.98-.8.83-2.12 1.47-3.25 1.38-.14-1.1.43-2.27 1.17-3.05.8-.85 2.2-1.47 3.31-1.31zM20.8 17.36c-.55 1.26-.82 1.82-1.53 2.94-1 1.52-2.4 3.41-4.15 3.43-1.55.02-1.95-1.01-4.06-1-2.1.01-2.55 1.02-4.1 1-1.74-.03-3.08-1.72-4.08-3.24C1.04 17.3.1 13.1 1.96 10.3c.93-1.4 2.4-2.28 3.8-2.28 1.5 0 2.45.99 3.69.99 1.2 0 1.93-1 3.72-1 1.27 0 2.61.69 3.54 1.88-3.11 1.7-2.6 6.14.09 7.47z"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

const oauthButtons: {
  id: LoginProviderId;
  label: string;
  icon: () => ReactNode;
}[] = [
  { id: "google", label: "Continue with Google", icon: GoogleIcon },
  { id: "github", label: "Continue with GitHub", icon: GitHubIcon },
  { id: "apple", label: "Continue with Apple", icon: AppleIcon },
  { id: "x", label: "Continue with X", icon: XIcon },
];

function Login() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const next = safeRedirectPath(search.next);
  const supabaseConfigured = Boolean(data.configured);
  const brokerConfigured = Boolean(data.brokerConfigured);
  const supabaseOAuthProviders = data.supabaseOAuthProviders ?? [];
  const [mode, setMode] = useState<Mode>(search.mode ?? "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Seed red banner from real /auth/callback ?error= (auth vs server); ignore bare noise.
  const [banner, setBanner] = useState<string | null>(
    () => loginErrorBannerFromSearch(search.error),
  );
  const [bannerKind, setBannerKind] = useState<LoginCallbackFailureKind | null>(
    () => loginCallbackFailureKind(search.error),
  );
  const [info, setInfo] = useState<string | null>(null);

  // Drop ?error= after mount so a refresh/stale restore does not re-paint the banner.
  useEffect(() => {
    if (typeof window === "undefined" || !search.error) return;
    if (!loginErrorBannerFromSearch(search.error)) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("error")) return;
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [search.error]);

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    setBannerKind(null);
    setInfo(null);
    const gate = emailPasswordGate(supabaseConfigured || emailAndPasswordEnabled);
    if (!gate.ok) {
      setInfo(gate.message);
      setBusy(false);
      return;
    }
    try {
      if (emailAndPasswordEnabled) {
        const name = email.split("@")[0] || "Owner";
        const result =
          mode === "sign-up"
            ? await authClient.signUp.email({ email, password, name })
            : await authClient.signIn.email({ email, password });
        if (result.error) {
          const message = result.error.message || "Sign-in failed.";
          setBanner(
            mode === "sign-in" && /^(INVALID_EMAIL_OR_PASSWORD|INVALID_CREDENTIALS|INVALID_PASSWORD)$/.test(result.error.code ?? "")
              ? "That email and password do not match. If this is your first time, switch to Sign up."
              : message,
          );
          return;
        }
        window.location.assign(next);
        return;
      }
      const action = mode === "sign-in" ? signInWithPassword : signUpWithPassword;
      const result = await action({
        data: { email, password, next },
      });
      if (result && "ok" in result && result.ok === false) {
        setBanner(result.error);
        setBannerKind("auth_error");
        return;
      }
      if (result && "needsConfirm" in result && result.needsConfirm) {
        setInfo(result.message);
        setMode("sign-in");
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      if (!/redirect/i.test(message)) {
        setBanner(message);
        setBannerKind("auth_error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onProvider(provider: LoginProviderId) {
    setBusy(true);
    setBanner(null);
    setBannerKind(null);
    setInfo(null);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(LOGIN_LAST_OAUTH_PROVIDER_KEY, provider);
      }
    } catch {
      /* ignore quota / private mode */
    }
    const action = resolveLoginProviderAction(provider, {
      supabaseConfigured,
      betterAuthEnabled: brokerConfigured && authEnabled,
      supabaseOAuthProviders,
    });
    try {
      if (action.kind === "not_configured") {
        setInfo(action.message);
        return;
      }
      if (action.kind === "supabase_oauth") {
        const result = await startOAuth({
          data: { provider: action.provider, next },
        });
        const target = oauthAuthorizeTarget(result);
        if (target) {
          window.location.assign(target);
          return;
        }
        if (result && "ok" in result && result.ok === false) {
          setBanner(result.error);
          setBannerKind("auth_error");
        } else {
          setBanner("Could not start provider sign-in.");
          setBannerKind("auth_error");
        }
        return;
      }
      await signIn(action.providerId, {
        callbackURL: next,
        errorCallbackURL: `/login?next=${encodeURIComponent(next)}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      if (!/redirect/i.test(message)) {
        setBanner(message);
        setBannerKind("auth_error");
      }
    } finally {
      setBusy(false);
    }
  }

  function retryLastOauth() {
    let last: string | null = null;
    try {
      last = typeof window !== "undefined"
        ? window.sessionStorage.getItem(LOGIN_LAST_OAUTH_PROVIDER_KEY)
        : null;
    } catch {
      last = null;
    }
    const allowed: LoginProviderId[] = ["google", "github", "apple", "x"];
    if (last && (allowed as string[]).includes(last)) {
      void onProvider(last as LoginProviderId);
      return;
    }
    setBanner(null);
    setBannerKind(null);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10 text-fg sm:px-6">
      <AuthCard>
        <AuthBrand
          title={mode === "sign-in" ? "Sign in" : "Create account"}
          subtitle="Grok, voice, REA, and the server copy run only for the signed-in owner."
        />

        {!supabaseConfigured ? (
          <div
            className="mt-5 rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted"
            role="status"
            data-testid="auth-not-configured"
          >
            <p className="font-medium text-fg">Supabase sign-in is not configured</p>
            <p className="mt-1.5">
              {emailAndPasswordEnabled ? "Email and password use Better Auth, a separate sign-in service." : "Email and password require a configured sign-in service."} GitHub and Apple require their own configuration. Google and X require the owner broker when available.
            </p>
          </div>
        ) : null}

        <div
          className="mt-6 grid grid-cols-2 gap-1 rounded-panel border border-line bg-bg p-1"
          role="tablist"
          aria-label="Account mode"
        >
          {(
            [
              ["sign-in", "Sign in"],
              ["sign-up", "Sign up"],
            ] as const
          ).map(([value, label]) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={busy}
                className={
                  active
                    ? "min-h-11 rounded-[calc(var(--radius-panel)-0.15rem)] bg-fg px-3 text-sm font-semibold text-bg transition-colors disabled:opacity-60"
                    : "min-h-11 rounded-[calc(var(--radius-panel)-0.15rem)] px-3 text-sm font-medium text-muted transition-colors hover:text-fg disabled:opacity-60"
                }
                onClick={() => {
                  setMode(value);
                  setBanner(null);
                  setBannerKind(null);
                  setInfo(null);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {banner && (
          <div
            className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-panel border border-danger/45 bg-danger/10 px-4 py-3"
            role="alert"
            data-testid="login-error-banner"
            data-failure-kind={bannerKind ?? "auth_error"}
          >
            <p className="text-sm leading-relaxed text-danger">{banner}</p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center rounded-panel border border-line bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2 disabled:opacity-60"
                data-testid="login-error-retry"
                disabled={busy}
                onClick={() => retryLastOauth()}
              >
                Retry
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center rounded-panel border border-line bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
                onClick={() => {
                  setBanner(null);
                  setBannerKind(null);
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {info && (
          <div
            className="mt-4 rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted"
            role="status"
            data-testid="login-inline-notice"
          >
            {info}
          </div>
        )}

        <form className="mt-5 flex flex-col gap-3.5" onSubmit={onPasswordSubmit}>
          <label className="block text-sm">
            <span className="text-[13px] font-medium text-muted">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClassName}
              placeholder="you@example.com"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[13px] font-medium text-muted">Password</span>
            <input
              type="password"
              autoComplete={
                mode === "sign-in" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "sign-up" ? 8 : 1}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClassName}
              placeholder={
                mode === "sign-up" ? "At least 8 characters" : "Your password"
              }
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            data-testid="login-password-submit"
            className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink transition-[opacity,transform] hover:opacity-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? (
              <>
                <Spinner />
                Working…
              </>
            ) : mode === "sign-in" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="flex flex-col gap-2">
          {oauthButtons.map((item) => {
            const Icon = item.icon;
            const action = resolveLoginProviderAction(item.id, {
              supabaseConfigured,
              betterAuthEnabled: brokerConfigured && authEnabled,
              supabaseOAuthProviders,
            });
            const disabled = busy || action.kind === "not_configured";
            const note = action.kind === "not_configured" ? action.message : undefined;
            return (
              <div key={item.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={disabled}
                  title={note}
                  aria-label={note ? `${item.label} (${note})` : item.label}
                  data-testid={`login-oauth-${item.id}`}
                  onClick={() => void onProvider(item.id)}
                  className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-panel border border-line bg-surface-2 px-4 text-sm font-semibold text-fg transition-colors hover:border-fg/25 hover:bg-bg disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Icon />
                  {item.label}
                </button>
                {note ? (
                  <p className="px-1 text-xs text-muted" data-testid={`login-oauth-${item.id}-note`}>
                    {note}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col gap-1 text-sm">
          <Link
            to="/"
            data-testid="login-back-home"
            className="inline-flex min-h-11 items-center font-medium text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            Back to the command page
          </Link>
          <Link
            to="/memory"
            data-testid="login-memory-manager"
            className="inline-flex min-h-11 items-center font-medium text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            Memory manager
          </Link>
        </div>
      </AuthCard>
    </main>
  );
}
