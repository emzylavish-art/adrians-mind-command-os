import { hasCueAttachments, readCue, type CuedMessage } from "./message-cue.ts";

export const QUEUE_TRANSFER_LIMIT = 2_500_000;
export const transferIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type QueueTransferScope =
  | { kind: "home" }
  | { kind: "chat"; id: string }
  | { kind: "work"; id: string | null };

export type QueueTransferBinding = {
  owner: string;
  scope: QueueTransferScope;
  receive: (item: CuedMessage) => boolean;
};

export function readTransferScope(input: unknown): QueueTransferScope | null {
  if (!input || typeof input !== "object" || !("kind" in input)) return null;
  if (input.kind === "home") return { kind: "home" };
  if (!("id" in input)) return null;
  const id = input.id;
  if (input.kind === "work" && id === null) return { kind: "work", id };
  if ((input.kind === "chat" || input.kind === "work") && typeof id === "string" && id.trim() && id.length <= 160) {
    return { kind: input.kind, id };
  }
  return null;
}

/** Only recoverable drafts can cross devices. Execution approval never crosses with them. */
export function transferableCue(input: unknown): CuedMessage | null {
  const [item] = readCue([input]);
  if (!item || !transferIdPattern.test(item.id) || item.claimed || item.attachmentsUnavailable || /^\s*\//.test(item.text)) return null;
  if (!item.text.trim() && !hasCueAttachments(item.attachments)) return null;
  return { id: item.id, text: item.text, paused: true, ...(item.attachments ? { attachments: item.attachments } : {}) };
}
