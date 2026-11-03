/**
 * PC shell Approve/Deny action results for the Tools panel.
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

export type PcApprovalAction = "approve" | "deny";

export type PcApprovalActionParams = {
  action: PcApprovalAction;
  approvalId: string;
  token: string;
  /** Required for approve; ignored for deny. */
  command?: string;
};

export type PcApprovalActionState =
  | { status: "idle" }
  | { status: "running"; action: PcApprovalAction; approvalId: string }
  | { status: "ok"; note: string }
  | { status: "error"; kind: HonestFailureKind; message: string; params: PcApprovalActionParams };

function failedCopy(action: PcApprovalAction): string {
  return action === "approve"
    ? HONEST_FAILURE_MESSAGES.pc_approve_failed
    : HONEST_FAILURE_MESSAGES.pc_deny_failed;
}

function statusOf(caught: unknown): number | null {
  if (!caught || typeof caught !== "object") return null;
  const record = caught as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const value of [record.status, record.statusCode, record.response?.status]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Map approve/deny rejection or non-ok body to one honest banner message + kind. */
export function classifyPcApprovalActionFailure(
  action: PcApprovalAction,
  caught: unknown,
): { kind: HonestFailureKind; message: string } {
  const failed = failedCopy(action);
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

export function pcApprovalActionUrl(action: PcApprovalAction): string {
  return action === "approve" ? "/api/mind/pc/approve" : "/api/mind/pc/deny";
}

export function pcApprovalActionBody(params: PcApprovalActionParams): Record<string, string> {
  if (params.action === "approve") {
    return { approvalId: params.approvalId, token: params.token, command: params.command ?? "" };
  }
  return { approvalId: params.approvalId, token: params.token };
}

/**
 * Run one Approve or Deny with identical params on Retry.
 * fetchImpl must return a Response; never throws — returns ok or error state fields.
 */
export async function runPcApprovalAction(
  params: PcApprovalActionParams,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
): Promise<
  | { ok: true; note: string }
  | { ok: false; kind: HonestFailureKind; message: string; params: PcApprovalActionParams }
> {
  try {
    const res = await fetchImpl(pcApprovalActionUrl(params.action), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pcApprovalActionBody(params)),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
    if (!res.ok) {
      const classified = classifyPcApprovalActionFailure(
        params.action,
        Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status }),
      );
      return { ok: false, ...classified, params };
    }
    if (!body || body.ok !== true) {
      const detail = body?.error?.trim() || `HTTP ${res.status}`;
      const classified = classifyPcApprovalActionFailure(params.action, detail);
      return { ok: false, ...classified, params };
    }
    if (params.action === "approve") {
      return { ok: true, note: `ok: ${body.text ?? "ran"}` };
    }
    return { ok: true, note: `denied ${params.approvalId}` };
  } catch (caught) {
    const classified = classifyPcApprovalActionFailure(params.action, caught);
    return { ok: false, ...classified, params };
  }
}

/** Snapshot params so Retry keeps byte-identical approve/deny payload. */
export function snapshotPcApprovalActionParams(params: PcApprovalActionParams): PcApprovalActionParams {
  return {
    action: params.action,
    approvalId: params.approvalId,
    token: params.token,
    ...(params.action === "approve" ? { command: params.command ?? "" } : {}),
  };
}

export { onceRetry };

/** Red failure banner for a failed Approve/Deny (Retry re-runs identical params). */
export function PcApprovalActionStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: PcApprovalActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className: "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": state.kind,
      "data-pc-approval-action": state.params.action,
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
