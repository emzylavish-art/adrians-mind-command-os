import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { requestPasswordReset } from "@/lib/supabase/actions";
import { PASSWORD_RESET_REQUEST_NEUTRAL } from "@/lib/supabase/password-reset";

export const Route = createFileRoute("/auth/forgot")({
  component: ForgotPasswordPage,
});

const inputClassName =
  "mt-1.5 min-h-11 w-full rounded-panel border border-line bg-bg px-3.5 text-[15px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-fg/35 focus:ring-2 focus:ring-fg/20 disabled:opacity-60";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    setInfo(null);
    try {
      const result = await requestPasswordReset({ data: { email } });
      if (result && "ok" in result && result.ok === false) {
        setBanner(result.error);
        return;
      }
      setInfo(
        (result && "message" in result && typeof result.message === "string"
          ? result.message
          : PASSWORD_RESET_REQUEST_NEUTRAL),
      );
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "Could not send a reset email.";
      setBanner(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10 text-fg sm:px-6">
      <div className="w-full max-w-[22.5rem] rounded-panel border border-line bg-surface p-7 shadow-[0_24px_64px_rgb(0_0_0_/_0.45)]">
        <header className="flex flex-col gap-3">
          <span className="logo-mark grid size-11 place-items-center rounded-2xl text-lg font-bold tracking-tight">
            A
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              Adrian&apos;s Mind
            </p>
            <h1 className="mt-1.5 font-display text-[1.75rem] font-bold leading-tight tracking-tight">
              Forgot password
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Enter the email for your account. We&apos;ll send a reset link when
              that address is registered.
            </p>
          </div>
        </header>

        {banner ? (
          <div
            className="mt-4 rounded-panel border border-danger/45 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-danger"
            role="alert"
            data-testid="forgot-error-banner"
          >
            {banner}
          </div>
        ) : null}

        {info ? (
          <div
            className="mt-4 rounded-panel border border-line bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted"
            role="status"
            data-testid="forgot-inline-notice"
          >
            {info}
          </div>
        ) : null}

        <form className="mt-5 flex flex-col gap-3.5" onSubmit={onSubmit}>
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
              data-testid="forgot-email-input"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            data-testid="forgot-submit"
            className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink transition-[opacity,transform] hover:opacity-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-1 text-sm">
          <Link
            to="/login"
            data-testid="forgot-back-login"
            className="inline-flex min-h-11 items-center font-medium text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
