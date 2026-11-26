/**
 * H33 Notion connector banners — unconfigured vs API reject vs timeout.
 * Classifies notionCommand / notionStatus outcomes for the existing failure banner.
 * Unconfigured/disconnected → configure notice (Connected → Setup). Never silent, never Retry.
 * API reject / timeout / unreachable → red banner, onceRetry of the same params, View log #audit-{id}.
 * command-app.tsx mount is owned by another lane (see NOTION_COMMAND_APP_MOUNT).
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  NOTION_UNCONFIGURED_NOTICE,
  classifyHonestFailure,
  honestFailureAuditAction,
  isNotionUnconfiguredNotice,
  isUserStoppedReply,
  mapNotionApiErrorCopy,
  shouldShowFailureBanner,
  type HonestFailureKind,
} from "./failure-states.ts";
import type { NotionTurn } from "./notion.ts";
import { onceRetry } from "./retry-fidelity.ts";
import { OAUTH_STATUS_FETCH_TIMEOUT_MS } from "./service-board-status.ts";

/**
 * Same budget as ServiceBoard connector status probes.
 * A stuck notionCommand / notionStatus becomes a timeout banner only after this,
 * matching fetchOauthStatusPayload / withListTimeout (the call must actually exceed the budget).
 */
export const NOTION_COMMAND_TIMEOUT_MS = OAUTH_STATUS_FETCH_TIMEOUT_MS;

export type NotionFailureSurface = "chat" | "status" | "connected";

export type NotionFailureParams = {
  text: string;
  confirmed: boolean;
  pageId: string | null;
  surface: NotionFailureSurface;
};

export type NotionFailure = {
  kind: HonestFailureKind;
  message: string;
  target: "notion";
  auditAction: string;
  params: NotionFailureParams;
};

export type NotionUnconfiguredNotice = {
  tone: "unconfigured";
  message: string;
  state: "unconfigured" | "disconnected";
  params: NotionFailureParams;
};

export type NotionConnectionStatus = {
  state: "unconfigured" | "disconnected" | "connected";
  detail: string;
};

export type NotionOutcome =
  | { tone: "ok"; turn: NotionTurn }
  | { tone: "needs_confirmation"; turn: NotionTurn }
  | { tone: "message"; turn: NotionTurn }
  | { tone: "unconfigured"; notice: NotionUnconfiguredNotice }
  | { tone: "auth_required"; message: string; params: NotionFailureParams }
  | { tone: "user_stopped"; message: string; params: NotionFailureParams }
  | { tone: "failure"; failure: NotionFailure };

export type NotionCatchOutcome =
  | { tone: "unconfigured"; notice: NotionUnconfiguredNotice }
  | { tone: "auth_required"; message: string; params: NotionFailureParams }
  | { tone: "user_stopped"; message: string; params: NotionFailureParams }
  | { tone: "failure"; failure: NotionFailure };

export type NotionStatusOutcome =
  | { tone: "connected"; state: "connected"; detail: string }
  | { tone: "unconfigured"; notice: NotionUnconfiguredNotice }
  | { tone: "auth_required"; message: string; params: NotionFailureParams }
  | { tone: "user_stopped"; message: string; params: NotionFailureParams }
  | { tone: "failure"; failure: NotionFailure };

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function snapshotNotionFailureParams(params: NotionFailureParams): NotionFailureParams {
  return {
    text: params.text,
    confirmed: false,
    pageId: params.pageId ?? null,
    surface: params.surface,
  };
}

/** Activity row id is `audit-${id}`. Invalid ids do not invent a link. */
export function notionFailureLogHref(auditId: string): string | null {
  const id = auditId.trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) return null;
  return `#audit-${id}`;
}

/** Prefer the server's one-line copy. Prefix only when it would otherwise stay unclassified. */
export function notionFailureMessage(error: string, state?: NotionTurn["state"]): string {
  const detail = oneLine(error);
  if (!detail) {
    if (state === "unconfigured") return HONEST_FAILURE_MESSAGES.notion_not_configured;
    if (state === "disconnected") return HONEST_FAILURE_MESSAGES.notion_disconnected;
    return HONEST_FAILURE_MESSAGES.notion_failed;
  }
  if (isUserStoppedReply(detail) || isNotionUnconfiguredNotice(detail)) return detail;
  const kind = classifyHonestFailure(detail);
  if (
    kind === "notion_failed" ||
    kind === "rate_limited" ||
    kind === "emergency_stop_active" ||
    kind === "auth_required" ||
    kind === "network_failure" ||
    kind === "forbidden_cross_site" ||
    kind === "mcp_tool_failed"
  ) {
    return detail;
  }
  const line = detail.startsWith("Notion ") ? detail : `Notion rejected the request. ${detail}`;
  return line.length > 300 ? `${line.slice(0, 299).trimEnd()}…` : line;
}

export function classifyNotionFailureMessage(message: string): HonestFailureKind | "user_stopped" {
  if (isUserStoppedReply(message)) return "user_stopped";
  return classifyHonestFailure(message) ?? "notion_failed";
}

function isNotionSoftResult(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (/Notion returned \d{3}\b|could not be reached|timed out|rejected the request|Nothing was invented|status could not be read|accepted a write/i.test(text)) {
    return false;
  }
  return /no matching pages?|More than one Notion result|Say whether to search|only after you confirm|Nothing was called\./i.test(text);
}

function isHardNotionDetail(detail: string): boolean {
  const text = detail.trim();
  if (!text || isNotionUnconfiguredNotice(text) || isUserStoppedReply(text)) return false;
  const kind = classifyHonestFailure(text);
  return (
    kind === "notion_failed" ||
    kind === "rate_limited" ||
    kind === "emergency_stop_active" ||
    kind === "network_failure" ||
    kind === "auth_required" ||
    /Notion returned \d{3}\b/i.test(text)
  );
}

function makeFailure(message: string, params: NotionFailureParams, state?: NotionTurn["state"]): NotionFailure {
  const line = notionFailureMessage(message, state);
  const kind = classifyNotionFailureMessage(line);
  const failureKind: HonestFailureKind = kind === "user_stopped" ? "notion_failed" : kind;
  return {
    kind: failureKind,
    message: line,
    target: "notion",
    auditAction: honestFailureAuditAction(failureKind),
    params,
  };
}

function unconfiguredNotice(
  message: string,
  state: "unconfigured" | "disconnected",
  params: NotionFailureParams,
): NotionUnconfiguredNotice {
  const fallback =
    state === "disconnected"
      ? HONEST_FAILURE_MESSAGES.notion_disconnected
      : HONEST_FAILURE_MESSAGES.notion_not_configured;
  const line = oneLine(message) || fallback;
  return { tone: "unconfigured", message: line, state, params };
}

/**
 * Map a NotionTurn into notice / failure / confirm / tool text.
 * Missing token and owner-disconnect are notices. HTTP reject, rate limit, halt, and
 * verify-miss are red failures. Empty search and "pick one" stay tool text.
 */
export function notionFailureFromTurn(turn: NotionTurn, params: NotionFailureParams): NotionOutcome {
  const snap = snapshotNotionFailureParams(params);
  const error = turn.error || "";
  if (isUserStoppedReply(error)) return { tone: "user_stopped", message: oneLine(error), params: snap };
  if (turn.needsConfirmation) return { tone: "needs_confirmation", turn };
  if (turn.ok) return { tone: "ok", turn };
  if (turn.state === "unconfigured" || turn.state === "disconnected") {
    if (isHardNotionDetail(error)) {
      if (classifyHonestFailure(error) === "auth_required") {
        return { tone: "auth_required", message: HONEST_FAILURE_MESSAGES.auth_required, params: snap };
      }
      return { tone: "failure", failure: makeFailure(error, snap, turn.state) };
    }
    return { tone: "unconfigured", notice: unconfiguredNotice(error, turn.state, snap) };
  }
  if (turn.ambiguous || isNotionSoftResult(error)) return { tone: "message", turn };
  if (!turn.ok) {
    const message = notionFailureMessage(error, turn.state);
    if (classifyNotionFailureMessage(message) === "auth_required" || classifyHonestFailure(message) === "auth_required") {
      return { tone: "auth_required", message: HONEST_FAILURE_MESSAGES.auth_required, params: snap };
    }
    return { tone: "failure", failure: makeFailure(message, snap, turn.state) };
  }
  return { tone: "ok", turn };
}

/** Thrown client path (notionCommand reject, network, or withNotionCommandTimeout). */
export function notionFailureFromCatch(caught: unknown, params: NotionFailureParams): NotionCatchOutcome {
  const snap = snapshotNotionFailureParams(params);
  const raw = caught instanceof Error ? caught.message : typeof caught === "string" ? caught : "";
  const name = caught instanceof Error ? caught.name : "";
  const text = oneLine(raw);
  if (isUserStoppedReply(text)) return { tone: "user_stopped", message: text, params: snap };
  if (isNotionUnconfiguredNotice(text)) {
    const state = /disconnected/i.test(text) ? "disconnected" : "unconfigured";
    return { tone: "unconfigured", notice: unconfiguredNotice(text, state, snap) };
  }
  if (classifyHonestFailure(text) === "auth_required") {
    return { tone: "auth_required", message: HONEST_FAILURE_MESSAGES.auth_required, params: snap };
  }
  let message: string;
  if (name === "TimeoutError" || text === HONEST_FAILURE_MESSAGES.notion_timeout || /\btimed out\b/i.test(text)) {
    message = HONEST_FAILURE_MESSAGES.notion_timeout;
  } else if (!text) {
    message =
      params.surface === "status"
        ? HONEST_FAILURE_MESSAGES.notion_status_failed
        : HONEST_FAILURE_MESSAGES.notion_unreachable;
  } else if (/Failed to fetch|NetworkError|fetch failed|Load failed|ECONNREFUSED|ERR_NETWORK/i.test(text)) {
    message = HONEST_FAILURE_MESSAGES.notion_unreachable;
  } else {
    message = notionFailureMessage(text, params.surface === "status" ? undefined : "connected");
  }
  return { tone: "failure", failure: makeFailure(message, snap) };
}

/**
 * notionStatus() result. Null/invalid is a visible status failure, never a silent empty.
 * Unconfigured and disconnected keep the server's sentence and point at Setup.
 */
export function notionOutcomeFromStatus(
  status: NotionConnectionStatus | null | undefined,
  params: NotionFailureParams,
): NotionStatusOutcome {
  const snap = snapshotNotionFailureParams(params);
  if (!status || (status.state !== "unconfigured" && status.state !== "disconnected" && status.state !== "connected")) {
    return { tone: "failure", failure: makeFailure(HONEST_FAILURE_MESSAGES.notion_status_failed, snap) };
  }
  if (isUserStoppedReply(status.detail || "")) {
    return { tone: "user_stopped", message: oneLine(status.detail), params: snap };
  }
  if (status.state === "connected") {
    if (isHardNotionDetail(status.detail || "")) {
      if (classifyHonestFailure(status.detail) === "auth_required") {
        return { tone: "auth_required", message: HONEST_FAILURE_MESSAGES.auth_required, params: snap };
      }
      return { tone: "failure", failure: makeFailure(status.detail, snap, "connected") };
    }
    return { tone: "connected", state: "connected", detail: status.detail };
  }
  if (isHardNotionDetail(status.detail || "")) {
    return { tone: "failure", failure: makeFailure(status.detail, snap, status.state) };
  }
  return { tone: "unconfigured", notice: unconfiguredNotice(status.detail, status.state, snap) };
}

/**
 * Race a Notion call against NOTION_COMMAND_TIMEOUT_MS.
 * Settles even when the callee ignores AbortSignal (same idea as withListTimeout).
 * A call that finishes inside the budget is returned unchanged — no timeout banner.
 */
export function withNotionCommandTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = NOTION_COMMAND_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutError = () => {
    const err = new Error(HONEST_FAILURE_MESSAGES.notion_timeout);
    err.name = "TimeoutError";
    return err;
  };
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      controller.abort(timeoutError());
      finish(() => reject(timeoutError()));
    }, timeoutMs);
    Promise.resolve()
      .then(() => run(signal))
      .then(
        (value) => finish(() => resolve(value)),
        (caught: unknown) =>
          finish(() => {
            const name = caught instanceof Error ? caught.name : "";
            const raw = caught instanceof Error ? caught.message : "";
            if (isUserStoppedReply(raw)) {
              reject(caught instanceof Error ? caught : new Error(raw));
              return;
            }
            if (name === "TimeoutError" || signal.aborted || /\btimed out\b/i.test(raw)) {
              reject(timeoutError());
              return;
            }
            reject(caught instanceof Error ? caught : new Error(HONEST_FAILURE_MESSAGES.notion_unreachable));
          }),
      );
  });
}

export { onceRetry, shouldShowFailureBanner, isNotionUnconfiguredNotice, NOTION_UNCONFIGURED_NOTICE, mapNotionApiErrorCopy };

/** Configure notice. Setup is the existing Connected / ServiceBoard control — no Retry. */
export function NotionUnconfiguredNoticeBanner({
  notice,
  onConfigure,
}: {
  notice: NotionUnconfiguredNotice;
  onConfigure: () => void;
}) {
  return createElement(
    "div",
    {
      className: "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-line bg-panel/60 px-4 py-2",
      role: "status",
      "data-testid": "notion-unconfigured-notice",
      "data-failure-kind": "notion_unconfigured",
      "data-notion-state": notice.state,
    },
    createElement(
      "p",
      { className: "text-sm text-muted", "data-testid": "notion-unconfigured-message" },
      notice.message || NOTION_UNCONFIGURED_NOTICE,
    ),
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "notion-configure",
        className: "inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm font-semibold",
        onClick: onConfigure,
      },
      "Setup",
    ),
  );
}

/** Red failure banner. View log is a link to the activity row `#audit-{id}`. */
export function NotionFailureBanner({
  failure,
  auditId,
  onRetry,
  onViewLog,
}: {
  failure: NotionFailure;
  auditId: string;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  const href = notionFailureLogHref(auditId);
  const log = href
    ? createElement(
        "a",
        {
          href,
          "data-testid": "failure-view-log",
          className: "inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-4 text-sm text-danger",
          onClick: () => onViewLog?.(),
        },
        "View log",
      )
    : onViewLog
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
      : null;
  return createElement(
    "div",
    {
      className: "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": failure.kind,
    },
    createElement("p", { className: "text-sm text-danger", "data-testid": "notion-error" }, failure.message),
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
      log,
    ),
  );
}

export function notionFailureMountHint(): string {
  return "askNotion/notionStatus: notionFailureFromTurn → unconfigured notice|reportFailure; catch → notionFailureFromCatch; withNotionCommandTimeout; Setup setView(\"connected\"); View log #audit-{id}; user_stopped is not red; never silent empty";
}

/**
 * Paste into command-app.tsx (this lane does not edit that file).
 * reportFailure already stores the audit row and the shell View log focuses `#audit-${auditId}`.
 */
export const NOTION_COMMAND_APP_MOUNT = `
// H33 — command-app owner. Do not add a route. Setup stays on view "connected".
import {
  notionFailureFromCatch,
  notionFailureFromTurn,
  notionOutcomeFromStatus,
  onceRetry,
  shouldShowFailureBanner,
  withNotionCommandTimeout,
} from "@/lib/mind/notion-failure-action";

const notionStatusParams = { text: "", confirmed: false, pageId: null as string | null, surface: "status" as const };

function reloadNotionStatus() {
  void withNotionCommandTimeout(() => notionStatus())
    .then((status) => {
      const outcome = notionOutcomeFromStatus(status, notionStatusParams);
      if (outcome.tone === "unconfigured") {
        setNotion({ state: outcome.notice.state, detail: outcome.notice.message });
        setNotice(outcome.notice.message);
        return;
      }
      if (outcome.tone === "user_stopped") {
        setNotice(outcome.message);
        return;
      }
      if (outcome.tone === "auth_required" || (outcome.tone === "failure" && !shouldShowFailureBanner(outcome.failure.message))) {
        setNotice(outcome.tone === "auth_required" ? outcome.message : outcome.failure.message);
        return;
      }
      if (outcome.tone === "failure") {
        const retry = onceRetry(() => { reloadNotionStatus(); });
        reportFailure(outcome.failure.message, outcome.failure.auditAction, "notion", retry);
        return;
      }
      setNotion({ state: "connected", detail: outcome.detail });
    })
    .catch((caught) => {
      const outcome = notionFailureFromCatch(caught, notionStatusParams);
      if (outcome.tone === "user_stopped") { setNotice(outcome.message); return; }
      if (outcome.tone === "unconfigured") {
        setNotion({ state: outcome.notice.state, detail: outcome.notice.message });
        setNotice(outcome.notice.message);
        return;
      }
      if (outcome.tone === "auth_required" || !shouldShowFailureBanner(outcome.failure.message)) {
        setNotice(outcome.tone === "auth_required" ? outcome.message : outcome.failure.message);
        return;
      }
      const retry = onceRetry(() => { reloadNotionStatus(); });
      reportFailure(outcome.failure.message, outcome.failure.auditAction, "notion", retry);
    });
}

// askNotion: replace the body. Retry calls askNotion with the snapshotted text/confirmed/pageId.
async function askNotion(chat, text, confirmed = false, pageId = null) {
  const params = { text, confirmed, pageId, surface: "chat" as const };
  setBusy(true);
  setError(null);
  try {
    const result = await withNotionCommandTimeout(() => notionCommand({ data: { text, confirmed, pageId } }));
    setBusy(false);
    const outcome = notionFailureFromTurn(result, params);
    if (outcome.tone === "user_stopped") { setNotice(outcome.message); return; }
    if (outcome.tone === "unconfigured") {
      setNotion({ state: outcome.notice.state, detail: outcome.notice.message });
      setNotice(outcome.notice.message);
      clearFailure();
      return;
    }
    if (outcome.tone === "auth_required") { setNotice(outcome.message); return; }
    if (outcome.tone === "needs_confirmation" && outcome.turn.pages[0]) {
      const target = outcome.turn.pages[0];
      setPending({ id: target.id, kind: "notion-append", label: "Append to Notion", detail: outcome.turn.error, confirm: "Append", run: () => { void askNotion(chat, text, true, target.id); } });
      return;
    }
    if (outcome.tone === "failure") {
      if (!shouldShowFailureBanner(outcome.failure.message)) { setNotice(outcome.failure.message); return; }
      const retryParams = outcome.failure.params;
      const retry = onceRetry(() => { void askNotion(chat, retryParams.text, retryParams.confirmed, retryParams.pageId); });
      reportFailure(outcome.failure.message, outcome.failure.auditAction, "notion", retry);
      return;
    }
    const lines = [result.error, ...result.pages.map((page) => page.title + " — " + page.url), result.content].filter(Boolean);
    recordToolTurn(chat, text, lines.join("\\n") || "Notion returned nothing.");
  } catch (caught) {
    setBusy(false);
    const outcome = notionFailureFromCatch(caught, params);
    if (outcome.tone === "user_stopped") { setNotice(outcome.message); return; }
    if (outcome.tone === "unconfigured") {
      setNotion({ state: outcome.notice.state, detail: outcome.notice.message });
      setNotice(outcome.notice.message);
      clearFailure();
      return;
    }
    if (outcome.tone === "auth_required" || !shouldShowFailureBanner(outcome.failure.message)) {
      setNotice(outcome.tone === "auth_required" ? outcome.message : outcome.failure.message);
      return;
    }
    const retryParams = outcome.failure.params;
    const retry = onceRetry(() => { void askNotion(chat, retryParams.text, retryParams.confirmed, retryParams.pageId); });
    reportFailure(outcome.failure.message, outcome.failure.auditAction, "notion", retry);
  }
}

// Unconfigured inline notice (optional; setNotice already carries the sentence):
// <NotionUnconfiguredNoticeBanner notice={notice} onConfigure={() => setView("connected")} />
// That view's ServiceBoard Setup button is the existing configuration UI. Do not add a settings route.
// Shell View log: setView("activity"); setFocusAuditId(failure.auditId) → #audit-\${failure.auditId}
// Inline banner link: <a href={notionFailureLogHref(auditId)} data-testid="failure-view-log">View log</a>
`.trim();
