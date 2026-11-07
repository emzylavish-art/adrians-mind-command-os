/**
 * H32 research-layer banners.
 * Classifies searchWeb / performSearch / performDeepResearch outcomes for Retry banners.
 * Partial deep is a warning tone with citations kept — never invents “sources found” on failure.
 * command-app.tsx mount is owned by Grok Build / Merge Gate (see researchFailureMountHint).
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  honestFailureAuditAction,
  type HonestFailureKind,
} from "./failure-states.ts";
import { SEARCH_TIMEOUT_REPLY, type ResearchCitation, type ResearchResult } from "./research.ts";
import { onceRetry } from "./retry-fidelity.ts";

export type ResearchFailureParams = {
  query: string;
  /** Research page vs chat web_research intent. */
  surface: "research_page" | "chat";
};

export type ResearchFailure = {
  kind: HonestFailureKind;
  message: string;
  target: "search";
  auditAction: string;
  params: ResearchFailureParams;
};

export type ResearchPartialWarning = {
  tone: "partial";
  message: string;
  citations: ResearchCitation[];
  summary: string;
  params: ResearchFailureParams;
};

export type ResearchOutcome =
  | { tone: "ok"; citations: ResearchCitation[]; summary: string }
  | { tone: "partial"; warning: ResearchPartialWarning }
  | { tone: "failure"; failure: ResearchFailure }
  | { tone: "empty_query"; message: string };

const EMPTY_QUERY = "Write what you want researched.";

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Prefer provider-honest copy; never invent a citation count on failure. */
export function researchFailureMessage(error: string, configured: boolean): string {
  const detail = oneLine(error);
  if (!detail) {
    return configured
      ? HONEST_FAILURE_MESSAGES.research_failed
      : HONEST_FAILURE_MESSAGES.research_not_configured;
  }
  // Keep research.ts copy verbatim when it already matches classifiers.
  if (classifyHonestFailure(detail) === "research_failed" || classifyHonestFailure(detail) === "rate_limited") {
    return detail;
  }
  if (!configured) {
    return detail.includes("citation") || detail.includes("configured") || detail.includes("MIND_SEARCH")
      ? detail
      : HONEST_FAILURE_MESSAGES.research_not_configured;
  }
  return detail.includes("citation") || detail.includes("search") || detail.includes("Research")
    ? detail
    : `${detail} No citations were created.`;
}

export function classifyResearchFailureMessage(message: string): HonestFailureKind {
  const kind = classifyHonestFailure(message);
  if (kind === "rate_limited") return "rate_limited";
  if (kind === "research_failed") return "research_failed";
  if (kind === "emergency_stop_active") return "emergency_stop_active";
  if (kind === "auth_required") return "auth_required";
  if (kind === "network_failure") return "network_failure";
  // Timeouts from research.ts use SEARCH_TIMEOUT_REPLY → research_failed via markers.
  if (message.includes(SEARCH_TIMEOUT_REPLY) || message === HONEST_FAILURE_MESSAGES.research_timeout) {
    return "research_failed";
  }
  return "research_failed";
}

/**
 * Map a ResearchResult (or thrown catch message) into banner/warning/ok.
 * ok+partial → warning (citations preserved). ok → success. !ok → red failure.
 */
export function researchFailureFromResult(
  result: ResearchResult,
  params: ResearchFailureParams,
): ResearchOutcome {
  const query = params.query;
  if (!result.ok) {
    if (result.error.trim() === EMPTY_QUERY) {
      return { tone: "empty_query", message: EMPTY_QUERY };
    }
    const message = researchFailureMessage(result.error, result.configured);
    const kind = classifyResearchFailureMessage(message);
    return {
      tone: "failure",
      failure: {
        kind,
        message,
        target: "search",
        auditAction: kind === "rate_limited" ? "rate_limited" : honestFailureAuditAction(kind),
        params: { query, surface: params.surface },
      },
    };
  }
  const summary = result.summary?.trim() || "";
  if (result.partial) {
    return {
      tone: "partial",
      warning: {
        tone: "partial",
        message: HONEST_FAILURE_MESSAGES.research_partial,
        citations: result.citations,
        summary,
        params: { query, surface: params.surface },
      },
    };
  }
  return { tone: "ok", citations: result.citations, summary };
}

/** Thrown client path (searchWeb reject / network). */
export function researchFailureFromCatch(
  caught: unknown,
  params: ResearchFailureParams,
): ResearchFailure {
  const raw =
    caught instanceof Error
      ? caught.message
      : typeof caught === "string"
        ? caught
        : "";
  const fallback = "The search provider could not be reached. No citations were created.";
  const message = researchFailureMessage(raw || fallback, true);
  const kind = classifyResearchFailureMessage(message);
  return {
    kind,
    message,
    target: "search",
    auditAction: kind === "rate_limited" ? "rate_limited" : honestFailureAuditAction(kind),
    params: { query: params.query, surface: params.surface },
  };
}

export function snapshotResearchFailureParams(params: ResearchFailureParams): ResearchFailureParams {
  return { query: params.query, surface: params.surface };
}

export { onceRetry, SEARCH_TIMEOUT_REPLY };

/** Warning banner for partial deep — not role=alert danger; citations remain on the page. */
export function ResearchPartialWarningBanner({
  warning,
  onRetry,
  onViewLog,
  onOpenResearch,
}: {
  warning: ResearchPartialWarning;
  onRetry?: (() => void) | null;
  onViewLog?: (() => void) | null;
  onOpenResearch?: (() => void) | null;
}) {
  return createElement(
    "div",
    {
      className:
        "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-warning/40 bg-warning/10 px-4 py-2",
      role: "status",
      "data-testid": "research-partial-banner",
      "data-failure-kind": "research_partial",
    },
    createElement(
      "p",
      { className: "text-sm text-warning", "data-testid": "research-partial-message" },
      warning.message,
    ),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      onRetry
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "failure-retry",
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink",
              onClick: onRetry,
            },
            "Retry",
          )
        : null,
      onOpenResearch
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "research-open-page",
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm font-semibold",
              onClick: onOpenResearch,
            },
            "Open Research",
          )
        : null,
      onViewLog
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "failure-view-log",
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm font-semibold",
              onClick: onViewLog,
            },
            "View log",
          )
        : null,
    ),
  );
}

/** Red failure banner for research hard failures (mirrors command-app contract). */
export function ResearchFailureBanner({
  failure,
  onRetry,
  onViewLog,
  onOpenResearch,
}: {
  failure: ResearchFailure;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
  onOpenResearch?: (() => void) | null;
}) {
  return createElement(
    "div",
    {
      className:
        "flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": failure.kind,
    },
    createElement("p", { className: "text-sm text-danger", "data-testid": "research-error" }, failure.message),
    createElement(
      "div",
      { className: "flex flex-wrap gap-2" },
      createElement(
        "button",
        {
          type: "button",
          "data-testid": "failure-retry",
          className:
            "inline-flex min-h-11 items-center justify-center rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink",
          onClick: onRetry,
        },
        "Retry",
      ),
      onOpenResearch
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "research-open-page",
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm font-semibold",
              onClick: onOpenResearch,
            },
            "Open Research",
          )
        : null,
      onViewLog
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "failure-view-log",
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm font-semibold",
              onClick: onViewLog,
            },
            "View log",
          )
        : null,
    ),
  );
}

/**
 * MOUNT (command-app owning lane — error-banners does not edit command-app):
 *
 * startResearch / runWebResearch after searchWeb:
 *   const outcome = researchFailureFromResult(result, { query, surface: "research_page"|"chat" });
 *   if (outcome.tone === "failure") reportFailure(outcome.failure.message, outcome.failure.auditAction, "search", () => { setResearchText(query); void startResearch(); });
 *   if (outcome.tone === "partial") { setResearchCitations(outcome.warning.citations); setResearchNote(outcome.warning.summary); setResearchPartial(outcome.warning); clearFailure(); }
 *   if (outcome.tone === "ok") { clearFailure(); setResearchPartial(null); ... }
 * catch: researchFailureFromCatch → reportFailure
 * Chat path runWebResearch currently only setResearchNote — must call reportFailure on failure tone.
 */
export function researchFailureMountHint(): string {
  return "startResearch/runWebResearch: researchFailureFromResult → reportFailure|ResearchPartialWarningBanner; catch → researchFailureFromCatch; never invent sources on failure";
}
