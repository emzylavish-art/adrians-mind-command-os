import type { CuedMessage } from "../message-cue.ts";

export type QueuedPlanApproval = { predecessor: string; scope: string; itemId: string; text: string };

export function canQueuePlan(item: CuedMessage) {
  return Boolean(item.text.trim()) && !item.text.trimStart().startsWith("/") && !item.claimed && !item.attachments && !item.attachmentsUnavailable;
}

export function approvedPlan(approval: QueuedPlanApproval, previous: { id: string; succeeded: boolean }, scope: string | null, rows: CuedMessage[]) {
  if (!previous.succeeded || approval.predecessor !== previous.id || approval.scope !== scope) return;
  return rows.find(item => item.id === approval.itemId && item.text === approval.text && canQueuePlan(item));
}
