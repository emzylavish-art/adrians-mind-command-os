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

  return (
    <div className="mt-2 space-y-2" data-testid="supabase-account">
      <p className="text-sm text-muted">
        {email ? (
          <>
            Signed in as <span className="text-fg">{email}</span>
          </>
        ) : (
          "Not signed in with Supabase"
        )}
      </p>
      {email && (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-panel border border-line px-3 text-sm disabled:opacity-60"
          onClick={() => {
            setBusy(true);
            void signOutSupabase().catch(() => setBusy(false));
          }}
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      )}
    </div>
  );
}
