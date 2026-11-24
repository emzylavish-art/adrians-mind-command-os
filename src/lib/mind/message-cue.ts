export type CuedMessage = {
  id: string;
  text: string;
};

export type CueResult<T extends CuedMessage = CuedMessage> = {
  queue: T[];
  error?: string;
};

export const CUE_LIMIT = 8;

export function cueMessage(queue: CuedMessage[], text: string, id: string): CueResult;
export function cueMessage<T extends CuedMessage>(queue: T[], item: T): CueResult<T>;
export function cueMessage(queue: CuedMessage[], item: CuedMessage | string, id?: string): CueResult {
  const message = typeof item === "string" ? { text: item, id: id! } : item;
  const trimmed = message.text.trim();
  if (!trimmed) return { queue, error: "Write the message before cueing it." };
  if (queue.length >= CUE_LIMIT) return { queue, error: "The cue holds 8 messages. Remove one before adding another." };
  return { queue: [...queue, { ...message, text: trimmed }] };
}

export function dropCued<T extends CuedMessage>(queue: T[], id: string): T[] {
  return queue.filter((item) => item.id !== id);
}

export function takeNextCue<T extends CuedMessage>(queue: T[], eligible: (item: T) => boolean = () => true): { next: T | null; queue: T[] } {
  const next = queue.find(eligible);
  return next ? { next, queue: dropCued(queue, next.id) } : { next: null, queue };
}

export function restoreCue<T extends CuedMessage>(queue: T[], held: T): T[] {
  if (queue.some((item) => item.id === held.id)) return queue;
  return [held, ...queue];
}
