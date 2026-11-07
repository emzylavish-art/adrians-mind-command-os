/**
 * Mounted stand-in for command-app's failure report.
 * A registered handler receives the outcome. With no handler, the existing alert stays.
 */

import { createElement, useState, type ReactNode } from "react";
import { emitFailure, mountFailure, type FailureSurface } from "@/lib/mind/failure-mount";

export function SurfaceFailureHost(props: {
  surface: FailureSurface;
  message: string;
  outcome: unknown;
  retry: () => void;
}): ReactNode {
  const [visible, setVisible] = useState<string | null>(null);
  function report() {
    const payload = mountFailure(props.outcome, props.retry);
    if (emitFailure(props.surface, payload)) return;
    setVisible(props.message);
  }
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", "data-testid": "report-failure", onClick: report }, "Report"),
    visible ? createElement("div", { role: "alert", "data-testid": "existing-failure-ui" }, visible) : null,
  );
}
