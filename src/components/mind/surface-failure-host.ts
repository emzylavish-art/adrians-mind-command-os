/**
 * Mounted stand-in for command-app's failure report.
 * A registered handler receives the outcome. With no handler, the existing alert stays.
 */

import { createElement, useState, type ReactNode } from "react";
import { emitFailure, mountFailure, type FailureSurface } from "@/lib/mind/failure-mount";

/** Handler wins. With no handler, the existing alert text stays. */
export function reportSurfaceFailure(input: {
  surface: FailureSurface;
  message: string;
  outcome: unknown;
  retry: () => void;
}): { handled: boolean; visible: string | null } {
  if (emitFailure(input.surface, mountFailure(input.outcome, input.retry))) {
    return { handled: true, visible: null };
  }
  return { handled: false, visible: input.message };
}

export function SurfaceFailureHost(props: {
  surface: FailureSurface;
  message: string;
  outcome: unknown;
  retry: () => void;
}): ReactNode {
  const [visible, setVisible] = useState<string | null>(null);
  function report() {
    const result = reportSurfaceFailure(props);
    if (result.handled) return;
    setVisible(result.visible);
  }
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", "data-testid": "report-failure", onClick: report }, "Report"),
    visible ? createElement("div", { role: "alert", "data-testid": "existing-failure-ui" }, visible) : null,
  );
}
