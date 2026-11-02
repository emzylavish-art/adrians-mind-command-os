/**
 * Supabase account menu probe / sign-out failures.
 * Probe rejections must not look like "not configured" (silent empty).
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "./failure-states.ts";
import { onceRetry } from "./retry-fidelity.ts";

export type SupabaseAccountAction = "probe" | "sign_out";

export type SupabaseAccountParams = {
  action: SupabaseAccountAction;
};

export type SupabaseAccountActionState =
  | { status: "idle" }
  | { status: "running"; action: SupabaseAccountAction }
  | { status: "ok" }
  | { status: "error"; kind: HonestFailureKind; message: string; params: SupabaseAccountParams };

export function snapshotSupabaseAccountParams(action: SupabaseAccountAction): SupabaseAccountParams {
  return { action };
}

function failedCopy(action: SupabaseAccountAction): string {
  return action === "probe"
    ? HONEST_FAILURE_MESSAGES.supabase_account_probe_failed
    : HONEST_FAILURE_MESSAGES.supabase_sign_out_failed;
}

export function classifySupabaseAccountFailure(
  action: SupabaseAccountAction,
  caught: unknown,
): { kind: HonestFailureKind; message: string } {
  const failed = failedCopy(action);
  const normalized = normalizeClientFailureMessage(caught);
  // TanStack redirect throws are not account failures — callers should filter them.
  if (isRedirectLike(caught)) {
    return { kind: "network_failure", message: failed };
  }
  const kind = classifyHonestFailure(normalized) ?? "network_failure";
  if (kind === "auth_required") {
    return { kind, message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  if (kind === "network_failure" || /Failed to fetch|NetworkError|timed out|timeout/i.test(normalized)) {
    return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
  }
  const detail = normalized.trim();
  return {
    kind: "network_failure",
    message: detail ? `${failed} ${detail}`.slice(0, 300) : `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}`,
  };
}

/** Detect TanStack Router / server-fn redirect throws so sign-out success is not painted as failure. */
export function isRedirectLike(caught: unknown): boolean {
  if (!caught || typeof caught !== "object") return false;
  const record = caught as { isRedirect?: unknown; options?: { to?: unknown }; to?: unknown };
  if (record.isRedirect === true) return true;
  if (typeof record.to === "string" && record.to.startsWith("/")) return true;
  if (record.options && typeof record.options === "object" && typeof (record.options as { to?: unknown }).to === "string") {
    return true;
  }
  return false;
}

export type AuthUserProbeResult = {
  configured: boolean;
  user: { email?: string | null } | null;
};

/**
 * Probe account status. Never throws. Honest configured:false is ok; rejection is error.
 */
export async function runSupabaseAccountProbe(
  probe: () => Promise<AuthUserProbeResult>,
): Promise<
  | { ok: true; configured: boolean; email: string | null }
  | { ok: false; kind: HonestFailureKind; message: string; params: SupabaseAccountParams }
> {
  const params = snapshotSupabaseAccountParams("probe");
  try {
    const result = await probe();
    return {
      ok: true,
      configured: result.configured === true,
      email: result.user?.email ?? null,
    };
  } catch (caught) {
    const classified = classifySupabaseAccountFailure("probe", caught);
    return { ok: false, ...classified, params };
  }
}

/**
 * Sign out. Redirect throws count as ok (navigation). Other rejections are errors with Retry.
 */
export async function runSupabaseSignOut(
  signOut: () => Promise<unknown>,
): Promise<
  | { ok: true; redirected: boolean }
  | { ok: false; kind: HonestFailureKind; message: string; params: SupabaseAccountParams }
> {
  const params = snapshotSupabaseAccountParams("sign_out");
  try {
    await signOut();
    return { ok: true, redirected: false };
  } catch (caught) {
    if (isRedirectLike(caught)) return { ok: true, redirected: true };
    const classified = classifySupabaseAccountFailure("sign_out", caught);
    return { ok: false, ...classified, params };
  }
}

export { onceRetry };

export function SupabaseAccountFailureBanner({
  state,
  onRetry,
  onViewLog,
}: {
  state: SupabaseAccountActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className: "mt-2 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-3 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": state.kind,
      "data-supabase-account-action": state.params.action,
    },
    createElement("p", { className: "text-sm text-danger" }, state.message),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "failure-retry",
          className: "inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink",
          onClick: onRetry,
        },
        "Retry",
      ),
      onViewLog
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "failure-view-log",
              className: "inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-4 text-sm text-danger",
              onClick: onViewLog,
            },
            "View log",
          )
        : null,
    ),
  );
}
