import type { Autonomy } from "./types";

export type { Autonomy };

export type ActionClass = "ordinary" | "protected";

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
] as const;

export type ProtectedKind = (typeof PROTECTED)[number];

export function classifyAction(kind: string): ActionClass {
  return (PROTECTED as readonly string[]).includes(kind) ? "protected" : "ordinary";
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
  if (classifyAction(input.kind) === "protected") {
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
