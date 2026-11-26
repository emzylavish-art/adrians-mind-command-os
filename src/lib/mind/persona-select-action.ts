/**
 * Explore persona "Open in Chat" failures.
 * selectPersona ok:false must show a red Retry banner — never a muted note only.
 */
import { createElement } from "react";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  type HonestFailureKind,
} from "./failure-states.ts";
import type { PersonaCard, PersonaSource } from "./personas/directory.ts";
import { selectPersona, type PersonaSelectResult } from "./personas/selection.ts";
import { onceRetry } from "./retry-fidelity.ts";
import type { Workspace } from "./types.ts";

/** Identity fields needed to re-run selectPersona with identical card params. */
export type PersonaSelectParams = {
  cardId: string;
  name: string;
  source: PersonaSource;
  templateName?: string;
  templateId?: string;
  agentId?: string;
  /** live is always false for directory cards; kept for Retry fidelity. */
  live: false;
  description: string;
  role: string;
  category: PersonaCard["category"];
  roleCategory: PersonaCard["roleCategory"];
  tools: string[];
  badge: PersonaCard["badge"];
  statusLabel: string;
};

export type PersonaSelectActionState =
  | { status: "idle" }
  | { status: "error"; kind: HonestFailureKind; message: string; params: PersonaSelectParams };

export function snapshotPersonaSelectParams(card: PersonaCard): PersonaSelectParams {
  return {
    cardId: card.id,
    name: card.name,
    source: card.source,
    templateName: card.templateName,
    templateId: card.templateId,
    agentId: card.agentId,
    live: false,
    description: card.description,
    role: card.role,
    category: card.category,
    roleCategory: card.roleCategory,
    tools: [...card.tools],
    badge: card.badge,
    statusLabel: card.statusLabel,
  };
}

export function cardFromPersonaSelectParams(params: PersonaSelectParams): PersonaCard {
  return {
    id: params.cardId,
    name: params.name,
    description: params.description,
    role: params.role,
    category: params.category,
    roleCategory: params.roleCategory,
    source: params.source,
    templateName: params.templateName,
    templateId: params.templateId,
    agentId: params.agentId,
    tools: [...params.tools],
    live: false,
    badge: params.badge,
    statusLabel: params.statusLabel,
  };
}

function classifyPersonaSelectFailure(error: string): { kind: HonestFailureKind; message: string } {
  const failed = HONEST_FAILURE_MESSAGES.persona_select_failed;
  const detail = (error || "").trim();
  if (!detail) {
    return { kind: "network_failure", message: failed };
  }
  const kind = classifyHonestFailure(detail) ?? "network_failure";
  if (kind === "emergency_stop_active") {
    return { kind, message: detail };
  }
  // Prefer the selectPersona one-liner (already honest); still tag as network_failure for audit.
  return { kind: "network_failure", message: detail.slice(0, 300) };
}

/**
 * Run one persona open. Never throws. Error paths keep identical card params for Retry.
 */
export function runPersonaSelect(
  ws: Workspace,
  params: PersonaSelectParams,
  now?: string,
):
  | { ok: true; result: Extract<PersonaSelectResult, { ok: true }>; params: PersonaSelectParams }
  | { ok: false; kind: HonestFailureKind; message: string; params: PersonaSelectParams } {
  const snap = snapshotPersonaSelectParams(cardFromPersonaSelectParams(params));
  const result = selectPersona(ws, cardFromPersonaSelectParams(snap), now);
  if (!result.ok) {
    const classified = classifyPersonaSelectFailure(result.error);
    return { ok: false, ...classified, params: snap };
  }
  return { ok: true, result, params: snap };
}

export { onceRetry };

/** Red failure banner for a failed persona open (Retry re-opens identical card). */
export function PersonaSelectFailureBanner({
  state,
  onRetry,
  onViewLog,
}: {
  state: PersonaSelectActionState;
  onRetry: () => void;
  onViewLog?: (() => void) | null;
}) {
  if (state.status !== "error") return null;
  return createElement(
    "div",
    {
      className:
        "mt-4 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-danger/40 bg-danger/10 px-4 py-2",
      role: "alert",
      "data-testid": "failure-banner",
      "data-failure-kind": "persona_select_failed",
    },
    createElement("p", { className: "text-sm text-danger", "data-testid": "persona-error" }, state.message),
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
      onViewLog
        ? createElement(
            "button",
            {
              type: "button",
              "data-testid": "failure-view-log",
              className:
                "inline-flex min-h-11 items-center justify-center rounded-panel border border-danger/40 px-4 text-sm text-danger",
              onClick: onViewLog,
            },
            "View log",
          )
        : null,
    ),
  );
}
