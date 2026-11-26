/**
 * Helpers so failure-banner Retry re-sends identical deliver parameters
 * (text, images, history) and reads the live workspace for halt/history.
 */

export type RetryImage = { origin?: "attached" | "camera" | "generated" | "edited"; dataUrl: string; name?: string; mime?: string };
export type RetryHistoryItem = {
  role: "user" | "assistant" | "system" | string;
  content: string;
  images?: { dataUrl?: string; name?: string }[];
};

/** Same history the first attempt used: before the newest user turn when resume. */
export function historyForDeliver(
  messages: RetryHistoryItem[],
  resume: boolean,
  limit = Number.POSITIVE_INFINITY,
): RetryHistoryItem[] {
  const base = resume ? messages.slice(0, -1) : messages;
  return Number.isFinite(limit) ? base.slice(-limit) : base;
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
    if (image.origin !== undefined) next.origin = image.origin;
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

/**
 * What a composer send (or its Retry) should do, using the LIVE halt flag.
 * "empty" means no chat may be created (no blank "New session").
 */
export function commandSendPlan(input: { liveHalted: boolean; text: string; imageCount: number }): "blocked" | "empty" | "send" {
  if (!input.text.trim() && input.imageCount === 0) return "empty";
  if (input.liveHalted) return "blocked";
  return "send";
}

/** Wrap a banner Retry so repeated clicks fire the action exactly once. */
export function onceRetry(retry: (() => void) | null): (() => void) | null {
  if (!retry) return null;
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    retry();
  };
}
