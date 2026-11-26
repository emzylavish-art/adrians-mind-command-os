import { createElement, type ReactNode } from "react";

export type ResourcePhase = "loading" | "empty" | "offline" | "permission-required" | "error" | "ready";
export const RESOURCE_STATE_LABELS: Record<ResourcePhase, string> = {
  loading: "Loading", empty: "No saved items", offline: "Connection unavailable", "permission-required": "Permission required", error: "Action incomplete", ready: "Ready",
};

/** Shared presentation only. It never retries a write or grants a permission by mounting. */
export function ResourceState({ phase, title, children, action }: { phase: ResourcePhase; title?: string; children?: ReactNode; action?: { label: string; run: () => void; disabled?: boolean } }) {
  return createElement("section", { className: "resource-state rounded-panel border border-line p-4 text-sm", role: phase === "error" || phase === "permission-required" ? "alert" : "status", "aria-live": "polite", "aria-busy": phase === "loading", "data-resource-state": phase },
    createElement("p", { className: "font-semibold" }, title || RESOURCE_STATE_LABELS[phase]),
    children ? createElement("div", { className: "mt-2 text-muted" }, children) : null,
    action ? createElement("button", { type: "button", className: "mt-3 min-h-11 rounded-panel border border-line px-3", disabled: action.disabled || phase === "loading", onClick: action.run }, action.label) : null);
}
