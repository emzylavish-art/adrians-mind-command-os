import type { Autonomy } from "./types";

export type { Autonomy };

export type ActionClass = "ordinary" | "protected" | "unknown";

export type Decision = "allow" | "ask_owner" | "deny";

const PROTECTED = [
  "delete",
  "erase",
  "drop",
  "overwrite",
  "deploy",
  "pay",
  "publish",
  "rotate_secret",
  "change_governance",
  // Existing confirmation entry points: the adapter still validates its own operation grant.
  "tool",
  "notion-workspace",
  "notion-append",
  "mcp-call",
] as const;

export type ProtectedKind = (typeof PROTECTED)[number];

/** New adapters must register a policy kind before they can execute. */
export const ORDINARY_ACTIONS = ["chat", "lookup", "search"] as const;

export function classifyAction(kind: string): ActionClass {
  if ((PROTECTED as readonly string[]).includes(kind)) return "protected";
  return (ORDINARY_ACTIONS as readonly string[]).includes(kind) ? "ordinary" : "unknown";
}

export function decide(input: {
  autonomy: Autonomy;
  kind: string;
  halted: boolean;
  approvalToken: string | null;
  expectedToken: string | null;
}): { decision: Decision; reason: string } {
  if (input.halted) {
    return { decision: "deny", reason: "Emergency stop is on. No new action can run." };
  }
  const actionClass = classifyAction(input.kind);
  if (actionClass === "unknown") {
    return { decision: "deny", reason: "This operation has no registered authorization policy. Nothing was dispatched." };
  }
  if (actionClass === "protected") {
    if (!input.approvalToken || input.approvalToken !== input.expectedToken) {
      return {
        decision: "ask_owner",
        reason: "This action is protected. Automatic mode does not approve it.",
      };
    }
    return { decision: "allow", reason: "Owner approved this exact action." };
  }
  if (input.autonomy === "ask" && input.kind !== "chat") {
    if (!input.approvalToken || input.approvalToken !== input.expectedToken) {
      return { decision: "ask_owner", reason: "Ask mode waits before this step." };
    }
  }
  return { decision: "allow", reason: "Within the current mode." };
}

export function approvalTokenFor(actionId: string): string {
  return `approve:${actionId}`;
}
