import { lazy, Suspense, useState, type FormEvent, type ReactNode } from "react";
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
  authUserLoaderFallback,
  emailPasswordGate,
  formatLoginThrownError,
  loginErrorBannerFromSearch,
  resolveEmailPasswordBackend,
  resolveLoginProviderAction,
  serverFnRedirectHref,
  type LoginProviderId,
} from "@/lib/auth/login-providers";

const LazyMonoMotion = lazy(() =>
  import("@/components/mind/motion/MonoMotionGraphic").then((m) => ({ default: m.MonoMotionGraphic })),
);

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
    } catch (err) {
      // Never claim not-configured on a transient serverFn/hydration failure —
      // that paints a false banner in the in-app browser while SSR was fine.
      return authUserLoaderFallback(err);
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



/** Only email + Google + GitHub are offered. Unconfigured providers are hidden, not listed disabled. */
const oauthButtons: {
  id: Extract<LoginProviderId, "google" | "github">;
  label: string;
  icon: () => ReactNode;
}[] = [
  { id: "google", label: "Continue with Google", icon: GoogleIcon },
  { id: "github", label: "Continue with GitHub", icon: GitHubIcon },
];

function Login() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const next = safeRedirectPath(search.next);
  const supabaseConfigured = Boolean(data.configured);
  const brokerConfigured = Boolean(data.brokerConfigured);
  const supabaseOAuthProviders = data.supabaseOAuthProviders ?? [];
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Seed from allowlisted ?error= codes (callbacks); never raw query text.
  const [banner, setBanner] = useState<string | null>(
    () => loginErrorBannerFromSearch(search.error),
  );
  const [info, setInfo] = useState<string | null>(null);

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    setInfo(null);
    const backend = resolveEmailPasswordBackend({
      supabaseConfigured,
      betterAuthEmailEnabled: emailAndPasswordEnabled,
    });
    const gate = emailPasswordGate(backend !== "none");
    if (!gate.ok) {
      setInfo(gate.message);
      setBusy(false);
      return;
    }
    try {
      // Prefer Supabase when configured so existing Auth users keep working.
      // Better Auth email is only used when Supabase env is absent.
      if (backend === "better_auth") {
        const name = email.split("@")[0] || "Owner";
        const result =
          mode === "sign-up"
            ? await authClient.signUp.email({ email, password, name })
            : await authClient.signIn.email({ email, password });
        if (result.error) {
          const message = result.error.message || "Sign-in failed.";
          setBanner(
            mode === "sign-in" && /invalid|credential|password/i.test(message)
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
      // Success path: serverFn may RETURN the serialized redirect (not throw).
      const redirectTo = serverFnRedirectHref(result);
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      if (result && "ok" in result && result.ok === false) {
        setBanner(result.error);
        return;
      }
      if (result && "needsConfirm" in result && result.needsConfirm) {
        setInfo(result.message);
        setMode("sign-in");
      }
    } catch (err) {
      // createServerFn turns `throw redirect(...)` into a thrown Response (or a
      // serialized redirect object). Follow it; do not paint it as a failure.
      const redirectTo = serverFnRedirectHref(err);
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      const message = formatLoginThrownError(err);
      if (!/redirect/i.test(message)) {
        setBanner(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onProvider(provider: LoginProviderId) {
    setBusy(true);
    setBanner(null);
    setInfo(null);
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
        } else {
          setBanner("Could not start provider sign-in.");
        }
        return;
      }
      await signIn(action.providerId, {
        callbackURL: next,
        errorCallbackURL: `/login?next=${encodeURIComponent(next)}`,
      });
    } catch (err) {
      const redirectTo = serverFnRedirectHref(err);
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      const message = formatLoginThrownError(err);
      if (!/redirect/i.test(message)) {
        setBanner(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page-shell grid min-h-screen place-items-center bg-bg px-4 py-10 text-fg sm:px-6">
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
            <p className="font-medium text-fg">Supabase email sign-in isn&apos;t configured yet</p>
            <p className="mt-1.5">
              Google below still uses the owner broker when those env vars are
              set. Connect Supabase for email/password and GitHub.
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
                    ? "login-mode-tab login-mode-tab--active min-h-10 rounded-[calc(var(--radius-panel)-0.15rem)] bg-[#f4f4f5] px-3 text-sm font-semibold text-[#0a0a0b] transition-colors disabled:opacity-60"
                    : "login-mode-tab min-h-10 rounded-[calc(var(--radius-panel)-0.15rem)] px-3 text-sm font-medium text-muted transition-colors hover:text-fg disabled:opacity-60"
                }
                onClick={() => {
                  setMode(value);
                  setBanner(null);
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
          >
            <p className="text-sm leading-relaxed text-danger">{banner}</p>
            <button
              type="button"
              className="inline-flex min-h-9 shrink-0 items-center rounded-panel border border-line bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
              onClick={() => setBanner(null)}
            >
              Dismiss
            </button>
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
            <div className="relative mt-1.5">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                required
                minLength={mode === "sign-up" ? 8 : 1}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClassName.replace("mt-1.5 ", "") + " pr-12"}
                placeholder={
                  mode === "sign-up" ? "At least 8 characters" : "Your password"
                }
                data-testid="login-password-input"
              />
              <button
                type="button"
                data-testid="login-password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={busy}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 inline-flex min-w-11 items-center justify-center rounded-r-panel px-3 text-muted transition-colors hover:text-fg disabled:opacity-55"
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                    <path d="M3 3l18 18" strokeLinecap="round" />
                    <path d="M10.6 10.6a2 2 0 002.8 2.8" strokeLinecap="round" />
                    <path d="M9.9 5.1A10.4 10.4 0 0112 5c5 0 9.3 3.1 10.7 7.5a11.2 11.2 0 01-1.7 3.1M6.1 6.1A11.3 11.3 0 001.3 12.5C2.7 16.9 7 20 12 20c1.4 0 2.7-.3 3.9-.7" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
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
          {oauthButtons
            .map((item) => {
              const action = resolveLoginProviderAction(item.id, {
                supabaseConfigured,
                betterAuthEnabled: brokerConfigured && authEnabled,
                supabaseOAuthProviders,
              });
              return { item, action };
            })
            .filter(({ action }) => action.kind !== "not_configured")
            .map(({ item }) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  aria-label={item.label}
                  data-testid={`login-oauth-${item.id}`}
                  onClick={() => void onProvider(item.id)}
                  className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-panel border border-line bg-surface-2 px-4 text-sm font-semibold text-fg transition-colors hover:border-fg/25 hover:bg-bg disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <Icon />
                  {item.label}
                </button>
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
