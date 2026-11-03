/**
 * Memory manager action failures (empty note / thrown mutate).
 * Must show a red Retry banner that re-runs the identical last action — never a bare setError line.
 */
import { createElement } from "react";
import { sanitizeMemoryText } from "./memory/sanitize.ts";
import { onceRetry } from "./retry-fidelity.ts";
import type { MemoryScope } from "./types.ts";

export const MEMORY_SAVE_EMPTY = "Write a note before saving.";
export const MEMORY_EDIT_EMPTY = "Edited note cannot be empty.";
export const MEMORY_ACTION_FAILED = "The memory change could not be applied.";

export type MemoryActionParams =
  | { kind: "save_new"; text: string; scope: MemoryScope }
  | { kind: "save_edit"; id: string; text: string }
  | { kind: "delete"; id: string };

export type MemoryActionState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string; params: MemoryActionParams };

export function snapshotMemoryActionParams(params: MemoryActionParams): MemoryActionParams {
  if (params.kind === "save_new") return { kind: "save_new", text: params.text, scope: params.scope };
  if (params.kind === "save_edit") return { kind: "save_edit", id: params.id, text: params.text };
  return { kind: "delete", id: params.id };
}

export type MemoryActionMutators = {
  saveNew: (input: { text: string; scope: MemoryScope }) => void;
  saveEdit: (input: { id: string; text: string }) => void;
  remove: (input: { id: string }) => void;
};

/**
 * Validate + run one memory action. Never throws — returns ok or error with params for Retry.
 */
export function runMemoryAction(
  params: MemoryActionParams,
  mutators: MemoryActionMutators,
): { ok: true } | { ok: false; message: string; params: MemoryActionParams } {
  const snap = snapshotMemoryActionParams(params);
  try {
    if (snap.kind === "save_new") {
      const text = sanitizeMemoryText(snap.text);
      if (!text) return { ok: false, message: MEMORY_SAVE_EMPTY, params: snap };
      mutators.saveNew({ text, scope: snap.scope });
      return { ok: true };
    }
    if (snap.kind === "save_edit") {
      const text = sanitizeMemoryText(snap.text);
      if (!text) return { ok: false, message: MEMORY_EDIT_EMPTY, params: snap };
      mutators.saveEdit({ id: snap.id, text });
      return { ok: true };
    }
    mutators.remove({ id: snap.id });
    return { ok: true };
  } catch (caught) {
    const detail = caught instanceof Error && caught.message.trim() ? caught.message.trim() : MEMORY_ACTION_FAILED;
    return { ok: false, message: detail.slice(0, 300), params: snap };
  }
}

export { onceRetry };

export function MemoryActionFailureBanner({
  state,
  onRetry,
  onViewLog,
}: {
  state: MemoryActionState;
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
      "data-failure-kind": "memory_action_failed",
    },
    createElement("p", { className: "text-sm text-danger", "data-testid": "memory-error" }, state.message),
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
