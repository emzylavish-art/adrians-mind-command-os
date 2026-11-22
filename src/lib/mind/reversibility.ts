export type Consequence = {
  id: string;
  action: string;
  reversible: boolean;
  permitted: boolean;
};

export type ReversibilityStatus = "available-contract";

export const REVERSIBILITY_STATUS: ReversibilityStatus = "available-contract";
export const ROLLBACK_TARGET = "not connected" as const;

export function dryRun(input: Consequence): { executed: false; wouldRefuse: boolean; reason: string } {
  if (!input.action.trim()) return { executed: false, wouldRefuse: true, reason: "empty action" };
  if (!input.permitted) return { executed: false, wouldRefuse: true, reason: "permission missing" };
  if (!input.reversible) return { executed: false, wouldRefuse: true, reason: "no rollback target is connected" };
  return { executed: false, wouldRefuse: false, reason: "dry run only. Nothing was changed." };
}

export function rollBack(): { restored: false; reason: string } {
  return { restored: false, reason: "No backup or rollback target is connected." };
}

const DESTRUCTIVE_SPEECH = /\b(delete everything|wipe (?:the )?(?:disk|drive|pc)|format (?:the )?(?:disk|drive)|erase my files)\b/i;

export function destructiveSpeechRefusal(text: string): string | null {
  if (!DESTRUCTIVE_SPEECH.test(text)) return null;
  const result = dryRun({ id: "spoken", action: text.slice(0, 160), reversible: false, permitted: false });
  return `Adrian refused that. ${result.reason}. Nothing was deleted.`;
}
