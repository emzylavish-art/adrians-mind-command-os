import { signOut as signOutAllAccounts } from "@/lib/auth/client";
import { useEffect, useRef, useState } from "react";
import {
  getSupabaseAuthUser,
} from "@/lib/supabase/actions";
import {
  SupabaseAccountFailureBanner,
  onceRetry,
  runSupabaseAccountProbe,
  runSupabaseSignOut,
  type SupabaseAccountActionState,
} from "@/lib/mind/supabase-account-action";

/**
 * Shows the Supabase-signed-in email and a sign-out control in the account menu.
 * Uses server functions only — no client tokens.
 * Probe/network failures show a red Retry banner (never a silent empty "not configured").
 */
export function SupabaseAccountControls({
  onFailure,
}: {
  /** Optional: reportFailure for top View log — mount wiring may live outside this lane. */
  onFailure?: (message: string, retry: () => void) => void;
} = {}) {
  const [email, setEmail] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [actionState, setActionState] = useState<SupabaseAccountActionState>({ status: "idle" });
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;

  function loadAccount() {
    const run = () => {
      setActionState({ status: "running", action: "probe" });
      void runSupabaseAccountProbe(() => getSupabaseAuthUser()).then((result) => {
        if (result.ok) {
          setConfigured(result.configured);
          setEmail(result.email);
          setReady(true);
          setActionState({ status: "ok" });
          return;
        }
        setConfigured(false);
        setEmail(null);
        setReady(true);
        setActionState({
          status: "error",
          kind: result.kind,
          message: result.message,
          params: result.params,
        });
        const retry = onceRetry(() => run());
        if (retry) onFailureRef.current?.(result.message, retry);
      });
    };
    run();
  }

  useEffect(() => {
    loadAccount();
    // Probe once on mount; Retry re-enters loadAccount explicitly.
  }, []);

  if (!ready) return null;

  if (actionState.status === "error" && actionState.params.action === "probe") {
    return (
      <div className="mt-3 space-y-3 border-t border-line pt-3" data-testid="supabase-account">
        <SupabaseAccountFailureBanner
          state={actionState}
          onRetry={onceRetry(() => loadAccount()) ?? (() => undefined)}
        />
      </div>
    );
  }

  if (!configured) return null;

  return (
    <div
      className="mt-3 space-y-3 border-t border-line pt-3"
      data-testid="supabase-account"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface-2" aria-hidden="true">
          <img src="/brand/logos/supabase.svg" alt="" width={20} height={20} className="size-5 text-[#3ecf8e]" />
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
            setActionState({ status: "running", action: "sign_out" });
            const run = () => {
              setBusy(true);
              setActionState({ status: "running", action: "sign_out" });
              void runSupabaseSignOut(() => signOutAllAccounts("/login")).then((result) => {
                if (result.ok) {
                  setActionState({ status: "ok" });
                  // Redirect navigates away; if it returned without redirect, clear busy.
                  setBusy(false);
                  return;
                }
                setBusy(false);
                setActionState({
                  status: "error",
                  kind: result.kind,
                  message: result.message,
                  params: result.params,
                });
                const retry = onceRetry(() => run());
                if (retry) onFailureRef.current?.(result.message, retry);
              });
            };
            run();
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
      {actionState.status === "error" && actionState.params.action === "sign_out" ? (
        <SupabaseAccountFailureBanner
          state={actionState}
          onRetry={
            onceRetry(() => {
              setBusy(true);
              void runSupabaseSignOut(() => signOutAllAccounts("/login")).then((result) => {
                if (result.ok) {
                  setActionState({ status: "ok" });
                  setBusy(false);
                  return;
                }
                setBusy(false);
                setActionState({
                  status: "error",
                  kind: result.kind,
                  message: result.message,
                  params: result.params,
                });
              });
            }) ?? (() => undefined)
          }
        />
      ) : null}
    </div>
  );
}
