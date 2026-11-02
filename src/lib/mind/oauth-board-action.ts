/**
 * ServiceBoard OAuth Connect / Disconnect action results.
 * HTTP/network failures must show a red Retry banner — never a muted note only.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "./failure-states.ts";
import { onceRetry } from "./retry-fidelity.ts";

export type OauthBoardAction = "connect" | "disconnect";

export type OauthBoardActionParams = {
  action: OauthBoardAction;
  /** ServiceBoard row name (e.g. "Gmail"). */
  name: string;
  /** API path segment under /api/mind/oauth/{path}/… */
  path: string;
};

export type OauthBoardActionState =
  | { status: "idle" }
  | { status: "running"; action: OauthBoardAction; name: string }
  | { status: "ok"; note: string; name: string; redirectUrl?: string }
  | { status: "error"; kind: HonestFailureKind; message: string; params: OauthBoardActionParams };

function failedCopy(action: OauthBoardAction, name: string): string {
  if (action === "connect") {
    return `${name} OAuth could not be started. ${HONEST_FAILURE_MESSAGES.oauth_connect_failed}`;
  }
  return HONEST_FAILURE_MESSAGES.oauth_disconnect_failed;
}

function statusOf(caught: unknown): number | null {
  if (!caught || typeof caught !== "object") return null;
  const record = caught as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [record.status, record.statusCode, record.response?.status]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Map connect/disconnect rejection or non-ok body to one honest banner message + kind. */
export function classifyOauthBoardActionFailure(
  action: OauthBoardAction,
  name: string,
  caught: unknown,
): { kind: HonestFailureKind; message: string } {
  const failed = failedCopy(action, name);
  const status = statusOf(caught);
  const raw = caught instanceof Error ? caught.message : typeof caught === "string" ? caught : "";
  if (status === 401 || raw === "Unauthorized" || /sign in is required/i.test(raw)) {
    return { kind: "auth_required", message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (status === 403 || /cross-site request blocked|^Forbidden/i.test(raw)) {
    return { kind: "forbidden_cross_site", message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  }
  if (status !== null && status >= 500) {
    return { kind: "network_failure", message: `${failed} (HTTP ${status})` };
  }
  if (caught instanceof SyntaxError || /not valid JSON|Unexpected token|JSON\.parse|not JSON/i.test(raw)) {
    return { kind: "network_failure", message: `${failed} (response was not JSON)` };
  }
  const normalized = normalizeClientFailureMessage(caught);
  const kind = classifyHonestFailure(normalized);
  if (kind === "auth_required") {
    return { kind, message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  if (kind === "network_failure" || /Failed to fetch|NetworkError|fetch failed/i.test(raw)) {
    return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
  }
  const detail = (raw || normalized).trim();
  return {
    kind: "network_failure",
    message: detail ? `${failed} ${detail}`.slice(0, 300) : `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}`,
  };
}

export function oauthBoardActionUrl(params: OauthBoardActionParams): string {
  if (params.action === "connect") {
    return `/api/mind/oauth/${params.path}/start?format=json`;
  }
  return `/api/mind/oauth/${params.path}/disconnect`;
}

/**
 * Run one Connect (start JSON) or Disconnect with identical params on Retry.
 * Never throws — returns ok or error state fields. Connect ok includes redirectUrl (caller assigns).
 */
export async function runOauthBoardAction(
  params: OauthBoardActionParams,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
): Promise<
  | { ok: true; note: string; name: string; redirectUrl?: string; oauth?: { state: string; detail: string } }
  | { ok: false; kind: HonestFailureKind; message: string; params: OauthBoardActionParams }
> {
  const snap = snapshotOauthBoardActionParams(params);
  try {
    if (snap.action === "connect") {
      const res = await fetchImpl(oauthBoardActionUrl(snap), {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (!res.ok || !body?.ok || !body.url) {
        const classified = classifyOauthBoardActionFailure(
          "connect",
          snap.name,
          Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status }),
        );
        return { ok: false, ...classified, params: snap };
      }
      return {
        ok: true,
        note: `${snap.name} OAuth start ready.`,
        name: snap.name,
        redirectUrl: body.url,
      };
    }

    const res = await fetchImpl(oauthBoardActionUrl(snap), {
      method: "POST",
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      state?: string;
      detail?: string;
      error?: string;
    } | null;
    if (!res.ok) {
      const classified = classifyOauthBoardActionFailure(
        "disconnect",
        snap.name,
        Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status }),
      );
      return { ok: false, ...classified, params: snap };
    }
    if (!body?.state) {
      const classified = classifyOauthBoardActionFailure(
        "disconnect",
        snap.name,
        body?.error || "Disconnect failed. The board was not changed.",
      );
      return { ok: false, ...classified, params: snap };
    }
    return {
      ok: true,
      note: body.detail ?? `Disconnected ${snap.name}.`,
      name: snap.name,
      oauth: { state: body.state, detail: body.detail ?? "" },
    };
  } catch (caught) {
    const classified = classifyOauthBoardActionFailure(snap.action, snap.name, caught);
    return { ok: false, ...classified, params: snap };
  }
}

/** Snapshot params so Retry keeps byte-identical connect/disconnect path. */
export function snapshotOauthBoardActionParams(params: OauthBoardActionParams): OauthBoardActionParams {
  return {
    action: params.action,
    name: params.name,
    path: params.path,
  };
}

export { onceRetry };

/** Red failure banner for a failed Connect/Disconnect (Retry re-runs identical params). */
export function OauthBoardActionStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: OauthBoardActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className: "mt-3 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-3 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": state.kind,
      "data-oauth-board-action": state.params.action,
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
