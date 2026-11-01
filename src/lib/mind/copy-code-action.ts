/**
 * MessageBody "Copy code" clipboard action.
 * Failures (permission, insecure context, missing clipboard) must show a red one-line banner with Retry
 * that re-copies the identical code text — never a silent empty state.
 */
import { createElement } from "react";
import { onceRetry } from "./retry-fidelity.ts";

export const COPY_CODE_FAILED = "Could not copy that code. Nothing was written to the clipboard.";

export type CopyCodeParams = {
  blockIndex: number;
  code: string;
};

export type CopyCodeState =
  | { status: "idle" }
  | { status: "ok"; blockIndex: number }
  | { status: "error"; message: string; params: CopyCodeParams };

export function snapshotCopyCodeParams(blockIndex: number, code: string): CopyCodeParams {
  return { blockIndex, code };
}

export type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

/** Resolve the clipboard writer. Returns null when the browser has no clipboard API. */
export function resolveClipboardWriter(globalObj: { navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } } } | null | undefined): ClipboardWriter | null {
  const writeText = globalObj?.navigator?.clipboard?.writeText;
  if (typeof writeText !== "function") return null;
  return { writeText: (text: string) => writeText.call(globalObj!.navigator!.clipboard, text) };
}

/**
 * Copy identical code text. Never throws — returns ok or error with params for Retry.
 */
export async function runCopyCode(
  params: CopyCodeParams,
  writer: ClipboardWriter | null,
): Promise<{ ok: true; blockIndex: number } | { ok: false; message: string; params: CopyCodeParams }> {
  const snap = snapshotCopyCodeParams(params.blockIndex, params.code);
  if (!writer) {
    return { ok: false, message: COPY_CODE_FAILED, params: snap };
  }
  try {
    await writer.writeText(snap.code);
    return { ok: true, blockIndex: snap.blockIndex };
  } catch {
    return { ok: false, message: COPY_CODE_FAILED, params: snap };
  }
}

export { onceRetry };

export function CopyCodeFailureBanner({
  state,
  onRetry,
  onViewLog,
}: {
  state: CopyCodeState;
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
      "data-failure-kind": "copy_code_failed",
    },
    createElement("p", { className: "text-sm text-danger", "data-testid": "copy-code-error" }, state.message),
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
