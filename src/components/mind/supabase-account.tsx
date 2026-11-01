import { useEffect, useState } from "react";
import {
  getSupabaseAuthUser,
  signOutSupabase,
} from "@/lib/supabase/actions";

/**
 * Shows the Supabase-signed-in email and a sign-out control in the account menu.
 * Uses server functions only — no client tokens.
 */
export function SupabaseAccountControls() {
  const [email, setEmail] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getSupabaseAuthUser()
      .then((result) => {
        if (cancelled) return;
        setConfigured(result.configured);
        setEmail(result.user?.email ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setConfigured(false);
        setEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!configured) return null;

  const initial = (email?.[0] ?? "?").toUpperCase();

  return (
    <div
      className="mt-3 space-y-3 border-t border-line pt-3"
      data-testid="supabase-account"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-xs font-semibold text-fg"
          aria-hidden="true"
        >
          {email ? initial : "—"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            Supabase
          </p>
          <p className="mt-1 truncate text-sm text-fg">
            {email ? (
              email
            ) : (
              <span className="text-muted">Not signed in with Supabase</span>
            )}
          </p>
        </div>
      </div>
      {email && (
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-panel border border-line bg-bg px-3 text-sm font-medium text-fg transition-colors hover:border-fg/25 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={() => {
            setBusy(true);
            void signOutSupabase().catch(() => setBusy(false));
          }}
        >
          {busy ? (
            <>
              <svg
                className="size-4 animate-spin"
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
              Signing out…
            </>
          ) : (
            "Sign out"
          )}
        </button>
      )}
    </div>
  );
}
