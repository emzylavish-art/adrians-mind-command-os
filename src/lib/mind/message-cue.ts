export type CuedMessage = {
  id: string;
  text: string;
};

export type CueResult = {
  queue: CuedMessage[];
  error?: string;
};

export const CUE_LIMIT = 8;

export function cueMessage(queue: CuedMessage[], text: string, id: string): CueResult {
  const trimmed = text.trim();
  if (!trimmed) return { queue, error: "Write the message before cueing it." };
  if (queue.length >= CUE_LIMIT) return { queue, error: "The cue holds 8 messages. Remove one before adding another." };
  return { queue: [...queue, { id, text: trimmed }] };
}

export function dropCued(queue: CuedMessage[], id: string): CuedMessage[] {
  return queue.filter((item) => item.id !== id);
}

export function takeNextCue(queue: CuedMessage[]): { next: CuedMessage | null; queue: CuedMessage[] } {
  const [next, ...rest] = queue;
  if (!next) return { next: null, queue };
  return { next, queue: rest };
}

export function restoreCue(queue: CuedMessage[], held: CuedMessage): CuedMessage[] {
  if (queue.some((item) => item.id === held.id)) return queue;
  return [held, ...queue];
}
