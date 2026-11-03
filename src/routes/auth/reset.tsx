import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { completePasswordReset } from "@/lib/supabase/actions";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_INVALID_LINK,
  parsePasswordResetSearch,
} from "@/lib/supabase/password-reset";
import { serverFnRedirectHref } from "@/lib/auth/login-providers";

type ResetSearch = {
  token_hash?: string;
  tokenHash?: string;
  type?: string;
  code?: string;
  error?: string;
  error_description?: string;
};

export const Route = createFileRoute("/auth/reset")({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token_hash: typeof search.token_hash === "string" ? search.token_hash : undefined,
    tokenHash: typeof search.tokenHash === "string" ? search.tokenHash : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
    code: typeof search.code === "string" ? search.code : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string"
        ? search.error_description
        : undefined,
  }),
  component: ResetPasswordPage,
});

const inputClassName =
  "mt-1.5 min-h-11 w-full rounded-panel border border-line bg-bg px-3.5 text-[15px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted/60 focus:border-fg/35 focus:ring-2 focus:ring-fg/20 disabled:opacity-60";

function ResetPasswordPage() {
  const search = Route.useSearch();
  const parsed = parsePasswordResetSearch(search as Record<string, unknown>);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(
    () => parsed.error || null,
  );

  const hasProof = Boolean(parsed.tokenHash || parsed.code);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setBanner(null);
    if (password !== confirm) {
      setBanner("Those passwords do not match.");
      setBusy(false);
      return;
    }
    if (!hasProof) {
      setBanner(PASSWORD_RESET_INVALID_LINK);
      setBusy(false);
      return;
    }
    try {
      const result = await completePasswordReset({
        data: {
          tokenHash: parsed.tokenHash,
          code: parsed.code,
          password,
          type: parsed.type,
        },
      });
      const redirectTo = serverFnRedirectHref(result);
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      if (result && "ok" in result && result.ok === false) {
        setBanner(result.error);
      }
    } catch (err) {
      const redirectTo = serverFnRedirectHref(err);
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "Could not update password.";
      if (!/redirect/i.test(message)) setBanner(message);
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
              Choose a new password
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {hasProof
                ? "Enter a new password for your account."
                : "Open the reset link from your email to continue."}
            </p>
          </div>
        </header>

        {banner ? (
          <div
            className="mt-4 rounded-panel border border-danger/45 bg-danger/10 px-4 py-3 text-sm leading-relaxed text-danger"
            role="alert"
            data-testid="reset-error-banner"
          >
            {banner}
          </div>
        ) : null}

        <form className="mt-5 flex flex-col gap-3.5" onSubmit={onSubmit}>
          <label className="block text-sm">
            <span className="text-[13px] font-medium text-muted">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              disabled={busy || !hasProof}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClassName}
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              data-testid="reset-password-input"
            />
          </label>
          <label className="block text-sm">
            <span className="text-[13px] font-medium text-muted">Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={confirm}
              disabled={busy || !hasProof}
              onChange={(event) => setConfirm(event.target.value)}
              className={inputClassName}
              placeholder="Repeat password"
              data-testid="reset-password-confirm"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !hasProof}
            aria-busy={busy}
            data-testid="reset-submit"
            className="mt-1 inline-flex min-h-11 items-center justify-center gap-2 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink transition-[opacity,transform] hover:opacity-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-1 text-sm">
          <Link
            to="/auth/forgot"
            data-testid="reset-request-again"
            className="inline-flex min-h-11 items-center font-medium text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            Request a new reset link
          </Link>
          <Link
            to="/login"
            data-testid="reset-back-login"
            className="inline-flex min-h-11 items-center font-medium text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
