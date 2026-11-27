export type CuedMessage = {
  id: string;
  text: string;
  paused?: boolean;
  claimed?: boolean;
};

export type CueResult<T extends CuedMessage = CuedMessage> = {
  queue: T[];
  error?: string;
};

export const CUE_LIMIT = 8;
export const CUE_TEXT_LIMIT = 8_000;
export const EMPTY_CUE: CuedMessage[] = [];

export function cueMessage(queue: CuedMessage[], text: string, id: string): CueResult;
export function cueMessage<T extends CuedMessage>(queue: T[], item: T): CueResult<T>;
export function cueMessage(queue: CuedMessage[], item: CuedMessage | string, id?: string): CueResult {
  const message = typeof item === "string" ? { text: item, id: id! } : item;
  const trimmed = message.text.trim();
  if (!trimmed) return { queue, error: "Write the message before adding it to the queue." };
  if (trimmed.length > CUE_TEXT_LIMIT) return { queue, error: "Shorten the message to 8,000 characters or fewer." };
  if (queue.length >= CUE_LIMIT) return { queue, error: "The queue holds 8 messages. Remove one before adding another." };
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

export function readCue(value: unknown): CuedMessage[] {
  if (!Array.isArray(value)) return EMPTY_CUE;
  const rows: CuedMessage[] = [];
  for (const item of value.slice(0, CUE_LIMIT)) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 80 ||
        typeof item.text !== "string" || !item.text.trim() || item.text.length > CUE_TEXT_LIMIT ||
        rows.some(row => row.id === item.id)) continue;
    rows.push({ id: item.id, text: item.text, paused: item.paused !== false || item.claimed === true, claimed: item.claimed === true });
  }
  return rows;
}

export function moveCued<T extends CuedMessage>(queue: T[], id: string, offset: -1 | 1): T[] {
  const index = queue.findIndex(item => item.id === id);
  if (index < 0 || index + offset < 0 || index + offset >= queue.length) return queue;
  const next = [...queue];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return next;
}
