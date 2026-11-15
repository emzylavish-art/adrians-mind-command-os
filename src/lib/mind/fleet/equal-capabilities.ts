/**
 * Eve and every bot share one capability list.
 * This is not a second brain, a secret store, or a halt control.
 * Paired actions run only after the owner approves that exact action.
 */

export const FLEET_ACTIONS = ["file_read", "file_write", "file_delete", "terminal"] as const;

export type FleetAction = (typeof FLEET_ACTIONS)[number];

const FLEET_ACTION_SET: ReadonlySet<string> = new Set(FLEET_ACTIONS);

export function capabilitiesFor(botId: string): readonly FleetAction[] {
  void botId;
  return FLEET_ACTIONS;
}

export type BotRunDecision = { ok: true } | { ok: false; reason: string };

function isPointerAction(action: string): boolean {
  return /\b(mouse|keyboard|browser)\b/i.test(action);
}

function isOwnerOnlyControl(action: string): boolean {
  return /^(approve|halt)$/i.test(action);
}

export function canBotRun(input: {
  botId: string;
  action: string;
  approved: string | null;
  halted: boolean;
  actor: string;
}): BotRunDecision {
  const action = input.action.trim();
  const actor = input.actor.trim().toLowerCase();

  if (input.halted) {
    return { ok: false, reason: "Emergency stop is on. Nothing ran." };
  }
  if (isPointerAction(action)) {
    return { ok: false, reason: "Mouse, keyboard, and browser stay blocked." };
  }
  if (actor === "eve" && isOwnerOnlyControl(action)) {
    return { ok: false, reason: "Eve cannot approve an action or use halt." };
  }
  if (!FLEET_ACTION_SET.has(action)) {
    return { ok: false, reason: "That action is not a paired fleet action." };
  }
  if (input.approved !== action) {
    return { ok: false, reason: "Approve this exact action first. Nothing ran." };
  }
  return { ok: true };
}
