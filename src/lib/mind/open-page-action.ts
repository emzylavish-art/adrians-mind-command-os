/**
 * Tools panel "Open page" (inspectWebPage) results.
 * Failures must show a red Retry banner that re-opens the identical URL — never a muted note only.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  normalizeClientFailureMessage,
  type HonestFailureKind,
} from "./failure-states.ts";
import { onceRetry } from "./retry-fidelity.ts";

export type OpenPageParams = {
  url: string;
};

export type OpenPageActionState =
  | { status: "idle" }
  | { status: "running"; url: string }
  | { status: "ok"; note: string }
  | { status: "error"; kind: HonestFailureKind; message: string; params: OpenPageParams };

export type OpenPageInspectResult =
  | { ok: true; title: string; excerpt: string; error?: string }
  | { ok: false; title?: string; excerpt?: string; error: string };

export function snapshotOpenPageParams(url: string): OpenPageParams {
  return { url: typeof url === "string" ? url : "" };
}

function classifyOpenPageFailure(caught: unknown): { kind: HonestFailureKind; message: string } {
  const failed = HONEST_FAILURE_MESSAGES.open_page_failed;
  const normalized = normalizeClientFailureMessage(caught);
  const kind = classifyHonestFailure(normalized) ?? "network_failure";
  if (kind === "auth_required") {
    return { kind, message: `${failed} ${HONEST_FAILURE_MESSAGES.auth_required}` };
  }
  if (kind === "forbidden_cross_site") return { kind, message: HONEST_FAILURE_MESSAGES.forbidden_cross_site };
  if (kind === "emergency_stop_active") {
    return { kind, message: normalized.trim() || HONEST_FAILURE_MESSAGES.emergency_stop_active };
  }
  if (kind === "network_failure" || /Failed to fetch|NetworkError|timed out|timeout/i.test(normalized)) {
    return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
  }
  const detail = normalized.trim();
  if (detail) {
    // Prefer the server's honest one-liner when present; still prefix when it is a bare network phrase.
    if (/could not|did not|was not|failed|refused|Too many|Only an http/i.test(detail)) {
      return { kind: "network_failure", message: detail.slice(0, 300) };
    }
    return { kind: "network_failure", message: `${failed} ${detail}`.slice(0, 300) };
  }
  return { kind: "network_failure", message: `${failed} ${HONEST_FAILURE_MESSAGES.network_failure}` };
}

/**
 * Run one Open page via an injected inspectWebPage-compatible function.
 * Never throws. Error paths keep the identical URL params for Retry.
 */
export async function runOpenPage(
  params: OpenPageParams,
  inspect: (input: { data: { url: string } }) => Promise<OpenPageInspectResult>,
): Promise<
  | { ok: true; note: string; params: OpenPageParams }
  | { ok: false; kind: HonestFailureKind; message: string; params: OpenPageParams }
> {
  const snap = snapshotOpenPageParams(params.url);
  try {
    const result = await inspect({ data: { url: snap.url } });
    if (result.ok) {
      const title = result.title?.trim() || "(no title)";
      const excerpt = result.excerpt?.trim() || "";
      return { ok: true, note: excerpt ? `${title}\n${excerpt}` : title, params: snap };
    }
    const classified = classifyOpenPageFailure(result.error || HONEST_FAILURE_MESSAGES.open_page_failed);
    return { ok: false, ...classified, params: snap };
  } catch (caught) {
    const classified = classifyOpenPageFailure(caught);
    return { ok: false, ...classified, params: snap };
  }
}

export { onceRetry };

/** Red failure banner for a failed Open page (Retry re-runs identical URL). */
export function OpenPageActionStatusRows({
  state,
  onRetry,
  onViewLog,
}: {
  state: OpenPageActionState;
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
      "data-open-page-url": state.params.url,
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
