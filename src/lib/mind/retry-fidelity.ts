/**
 * Helpers so failure-banner Retry re-sends identical deliver parameters
 * (text, images, history) and reads the live workspace for halt/history.
 */

export type RetryImage = { dataUrl: string; name?: string; mime?: string };
export type RetryHistoryItem = {
  role: "user" | "assistant" | "system" | string;
  content: string;
  images?: { dataUrl?: string; name?: string }[];
};

/** Same history the first attempt used: before the newest user turn when resume. */
export function historyForDeliver(
  messages: RetryHistoryItem[],
  resume: boolean,
  limit = 12,
): RetryHistoryItem[] {
  const base = resume ? messages.slice(0, -1) : messages;
  return base.slice(-limit);
}

/** Prefer the live chat from the current workspace so resume history is not stale. */
export function resolveChatMessages(
  chats: { id: string; messages: RetryHistoryItem[] }[],
  chatId: string,
  fallback: { id: string; messages: RetryHistoryItem[] },
): RetryHistoryItem[] {
  return (chats.find((item) => item.id === chatId) ?? fallback).messages;
}

/** Snapshot images so Retry keeps byte-identical attachments. */
export function snapshotImages(images: RetryImage[]): RetryImage[] {
  return images.map((image) => {
    const next: RetryImage = { dataUrl: image.dataUrl };
    if (image.name !== undefined) next.name = image.name;
    if (image.mime !== undefined) next.mime = image.mime;
    return next;
  });
}

/**
 * Emergency stop must follow the LIVE halt flag only.
 * A stale source.halted from the original send must not block Retry after Clear stop.
 */
export function shouldBlockForEmergencyStop(liveHalted: boolean, _sourceHalted?: boolean): boolean {
  return liveHalted === true;
}
